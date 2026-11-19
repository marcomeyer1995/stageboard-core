#!/usr/bin/env node
/**
 * Soak test for a Host's database host (#960): several simulated devices write to one band at the same time,
 * replicate both ways with real PouchDB, join and check PINs, upload tracks - for hours - while the server's memory,
 * answer times and errors are recorded. It answers "does the built-in database host hold up on a laptop", with numbers.
 *
 *   node tools/soak/soak.mjs --url https://127.0.0.1:8449 --pid <server pid> --hours 3 --out /tmp/soak
 *
 * Needs the server's own machine (it founds the band as the server itself - POST /workspaces from the machine needs no
 * login) and `NODE_TLS_REJECT_UNAUTHORIZED=0` for the self-signed certificate. Writes `<out>/samples.csv` (one line
 * every `--sample` seconds) and `<out>/summary.json` at the end, and prints the summary. Exit code 1 when a check fails:
 * the devices did not end up with the same documents, or the server's memory kept growing.
 *
 * What it does not claim: it is one laptop, one network card and synthetic devices - not a gig. Real tablets, audio
 * output and clock sync stay "needs device verification".
 */
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import MemoryAdapter from 'pouchdb-adapter-memory'
import Replication from 'pouchdb-replication'

PouchDB.plugin(HttpAdapter).plugin(MemoryAdapter).plugin(Replication)

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const url = arg('url', 'https://127.0.0.1:8449').replace(/\/+$/, '')
const pid = Number(arg('pid', '0'))
const hours = Number(arg('hours', '3'))
const writers = Number(arg('writers', '3'))
const sampleSeconds = Number(arg('sample', '30'))
const out = arg('out', '/tmp/soak')
const band = arg('band', `soak${Date.now().toString(36)}`)
const songs = 150

mkdirSync(out, { recursive: true })
const started = Date.now()
const endAt = started + hours * 3_600_000
const stop = () => Date.now() >= endAt
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`

const stats = { requests: 0, failures: {}, latencies: { time: [], read: [], write: [], join: [] } }
const fail = (what) => {
  stats.failures[what] = (stats.failures[what] ?? 0) + 1
}
/** One timed request; failures are counted by what failed, never thrown into the test. */
async function timed(kind, label, run) {
  const t0 = performance.now()
  try {
    const result = await run()
    stats.requests += 1
    stats.latencies[kind].push(performance.now() - t0)
    return result
  } catch (err) {
    fail(`${label}: ${err?.status ?? err?.code ?? err?.message ?? err}`)
    return null
  }
}
const json = async (path, init = {}) => {
  const response = await fetch(`${url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}
const must = (condition, message) => {
  if (!condition) throw new Error(message)
}

// ---- the band ---------------------------------------------------------------------------------------------------
const founded = await json('/workspaces', { method: 'POST', body: JSON.stringify({ workspaceId: band, founderId: 'f1', workspaceName: 'Soak', deviceId: 'soak-founder' }) })
must(founded.status === 201, `could not found the band: HTTP ${founded.status} ${JSON.stringify(founded.body)}`)
const admin = { username: founded.body.username, password: founded.body.password }
const adminHeader = { Authorization: basic(admin.username, admin.password) }
const bandDb = `stageboard-${band}`
await json(`/db/${bandDb}/profiles:f1`, { method: 'PUT', headers: adminHeader, body: JSON.stringify({ _id: 'profiles:f1', id: 'f1', name: 'Founder', stageRoles: ['admin'] }) })
for (const n of ['p2', 'p3']) await json(`/db/${bandDb}/profiles:${n}`, { method: 'PUT', headers: adminHeader, body: JSON.stringify({ _id: `profiles:${n}`, id: n, name: n, stageRoles: [] }) })
const code = (await json(`/workspaces/${band}/access-code`, { method: 'POST', body: JSON.stringify({ adminUsername: admin.username, adminPassword: admin.password }) })).body?.code
must(code, 'no access code')
console.log(`band ${band} founded; ${writers} devices, ${hours} h, samples every ${sampleSeconds} s -> ${out}`)

// ---- devices: real PouchDB, replicating both ways with the server ---------------------------------------------------
const devices = []
for (let i = 0; i < writers; i++) {
  // Each device is a plain member with its own login, like a tablet.
  const joined = await json(`/workspaces/${band}/join/p2`, { method: 'POST', body: JSON.stringify({ code, deviceId: `soak-dev-${i}` }) })
  must(joined.status === 200 || joined.status === 201, `device ${i} could not join: ${joined.status}`)
  const local = new PouchDB(`soak-local-${band}-${i}`, { adapter: 'memory' })
  // Node's own fetch: PouchDB's bundled node-fetch drops keep-alive connections on current Node ("socket hang up"),
  // which is a problem of that client library, not of the server - a tablet or browser never goes through it.
  const remote = new PouchDB(`${url}/db/${bandDb}`, { auth: { username: joined.body.username, password: joined.body.password }, fetch: (input, init) => globalThis.fetch(input, init) })
  const sync = local.sync(remote, { live: true, retry: true })
  sync.on('error', () => fail(`device ${i} sync error`))
  sync.on('denied', () => fail(`device ${i} denied`))
  devices.push({ i, local, remote, sync, writes: 0, conflicts: 0 })
}

/** A device editing the shared songs the way a band would: pick a song, bump a field, sometimes at the same moment as
 * another device (a real conflict, resolved by CouchDB's rule - the same on every device and the host). */
async function writer(device) {
  while (!stop()) {
    const id = `songs:${Math.floor(Math.random() * songs)}`
    const result = await timed('write', `device ${device.i} write`, async () => {
      const existing = await device.local.get(id).catch(() => null)
      return device.local.put({ _id: id, ...(existing ? { _rev: existing._rev } : {}), title: `Song ${id}`, by: device.i, n: (existing?.n ?? 0) + 1, notes: 'x'.repeat(1_800 + Math.floor(Math.random() * 400)) })
    })
    if (result) device.writes += 1
    await sleep(120 + Math.random() * 160)
  }
}
/** Show state at 4 Hz from one device - what a playing band sends. */
async function showState(device) {
  let n = 0
  while (!stop()) {
    await timed('write', 'show-state', async () => {
      const existing = await device.local.get('show-state').catch(() => null)
      return device.local.put({ _id: 'show-state', ...(existing ? { _rev: existing._rev } : {}), playbackStatus: 'playing', tick: ++n })
    })
    await sleep(250)
  }
}
/** Reads through the proxy as a device does (the changes feed is held by the live sync). */
async function reader() {
  while (!stop()) {
    await timed('read', 'read', async () => {
      const response = await fetch(`${url}/db/${bandDb}/songs:${Math.floor(Math.random() * songs)}`, { headers: adminHeader })
      if (response.status !== 200 && response.status !== 404) throw new Error(`HTTP ${response.status}`)
      await response.arrayBuffer()
    })
    await sleep(100)
  }
}
/** `/time` is what the whole band's clock sync leans on: the answer time that matters most. */
async function clock() {
  while (!stop()) {
    await timed('time', 'time', async () => {
      const response = await fetch(`${url}/time`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await response.arrayBuffer()
    })
    await sleep(500)
  }
}
/** Joining and PIN checks cost PBKDF2 on the server: bursts of them must not stall the rest. */
async function accounts() {
  let n = 0
  while (!stop()) {
    n += 1
    await timed('join', 'join', async () => {
      const joined = await json(`/workspaces/${band}/join/p3`, { method: 'POST', body: JSON.stringify({ code, deviceId: `churn-${n % 40}` }) })
      if (joined.status !== 200 && joined.status !== 201) throw new Error(`HTTP ${joined.status}`)
    })
    await timed('join', 'verify-pin', async () => {
      const checked = await json(`/workspaces/${band}/verify-admin-pin`, { method: 'POST', body: JSON.stringify({ profileId: 'f1', pin: code.slice(-4) }) })
      if (checked.status !== 200 && checked.status !== 403) throw new Error(`HTTP ${checked.status}`)
    })
    await sleep(2_000)
  }
}
/** A 3 MB track every minute: big bodies are what exhausts memory on a small host. */
async function tracks() {
  const body = Buffer.alloc(3 * 1024 * 1024, 7)
  let n = 0
  while (!stop()) {
    n += 1
    const trackId = `t${n % 5}`
    await timed('write', 'audio upload', async () => {
      const put = await fetch(`${url}/audio/soakvar/${trackId}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...adminHeader }, body })
      if (!put.ok) throw new Error(`PUT HTTP ${put.status}`)
      const get = await fetch(`${url}/audio/soakvar/${trackId}`, { headers: adminHeader })
      if (!get.ok) throw new Error(`GET HTTP ${get.status}`)
      const got = Buffer.from(await get.arrayBuffer())
      if (got.length !== body.length) throw new Error(`track came back ${got.length} bytes, not ${body.length}`)
    })
    await sleep(60_000)
  }
}

// ---- samples ----------------------------------------------------------------------------------------------------
// `--mem-cmd "<shell command printing MB>"` samples any process by a command instead of /proc (a tablet host over adb:
//   --mem-cmd "adb -s <serial> shell dumpsys meminfo <package> | awk '/TOTAL PSS:/ {print int(\$3/1024)}'").
const memCmd = arg('mem-cmd', '')
const rssMb = () => {
  if (memCmd) {
    try {
      const mb = Number(execSync(memCmd, { encoding: 'utf-8', timeout: 20_000 }).trim())
      return Number.isFinite(mb) && mb > 0 ? mb : null
    } catch {
      return null
    }
  }
  if (!pid) return null
  try {
    const kb = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf-8'))?.[1]
    return kb ? Math.round(Number(kb) / 1024) : null
  } catch {
    return null
  }
}
const percentile = (values, p) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] * 10) / 10
}
const csv = join(out, 'samples.csv')
writeFileSync(csv, 'minute,rss_mb,requests,failures,time_p95_ms,write_p95_ms,device_writes\n')
const rss = []
async function sampler() {
  let last = { time: 0, write: 0 }
  while (!stop()) {
    await sleep(sampleSeconds * 1_000)
    const minute = Math.round((Date.now() - started) / 60_000)
    const memory = rssMb()
    if (memory !== null) rss.push({ minute, memory })
    const recent = (kind) => stats.latencies[kind].slice(-200)
    const failures = Object.values(stats.failures).reduce((a, b) => a + b, 0)
    appendFileSync(csv, `${minute},${memory ?? ''},${stats.requests},${failures},${percentile(recent('time'), 95) ?? ''},${percentile(recent('write'), 95) ?? ''},${devices.reduce((a, d) => a + d.writes, 0)}\n`)
    last = { time: stats.latencies.time.length, write: stats.latencies.write.length }
  }
}

await Promise.all([sampler(), clock(), reader(), accounts(), tracks(), showState(devices[0]), ...devices.map(writer)])

// ---- the end: do the devices agree? -----------------------------------------------------------------------------------
for (const device of devices) device.sync.cancel()
await sleep(1_000)
// One last full exchange, with nobody writing any more: every device must end with exactly what the host holds.
const settled = []
for (const device of devices) {
  await device.local.replicate.from(device.remote).catch(() => fail(`final pull ${device.i}`))
  await device.local.replicate.to(device.remote).catch(() => fail(`final push ${device.i}`))
}
for (const device of devices) await device.local.replicate.from(device.remote).catch(() => fail(`settle pull ${device.i}`))
const heads = async (db) => Object.fromEntries((await db.allDocs({ startkey: 'songs:', endkey: 'songs:￰' })).rows.map((row) => [row.id, row.value.rev]))
const hostHeads = await heads(devices[0].remote)
let diverged = 0
for (const device of devices) {
  const mine = await heads(device.local)
  const ids = new Set([...Object.keys(mine), ...Object.keys(hostHeads)])
  for (const id of ids) if (mine[id] !== hostHeads[id]) diverged += 1
  settled.push({ device: device.i, songs: Object.keys(mine).length })
}

const first = rss.find((r) => r.minute >= 5)?.memory ?? rss[0]?.memory ?? null
const peak = rss.length ? Math.max(...rss.map((r) => r.memory)) : null
const last = rss.at(-1)?.memory ?? null
// Growth over the second half only: warm-up and caches settle early, a leak keeps climbing.
const half = rss.slice(Math.floor(rss.length / 2))
const slope = half.length > 4 ? (half.at(-1).memory - half[0].memory) / Math.max(1, (half.at(-1).minute - half[0].minute) / 60) : null
const summary = {
  band,
  hours,
  startedAt: new Date(started).toISOString(),
  requests: stats.requests,
  failures: stats.failures,
  deviceWrites: devices.map((d) => d.writes),
  latencyMs: Object.fromEntries(Object.entries(stats.latencies).map(([k, v]) => [k, { n: v.length, p50: percentile(v, 50), p95: percentile(v, 95), p99: percentile(v, 99), max: v.length ? Math.round(v.reduce((m, x) => (x > m ? x : m), 0)) : null }])),
  rssMb: { afterWarmup: first, peak, last, growthPerHourSecondHalf: slope === null ? null : Math.round(slope * 10) / 10 },
  songsPerDevice: settled,
  divergedSongs: diverged,
}
// Fails when the devices disagree with the host, or memory keeps climbing by more than 30 MB an hour in the second half.
summary.ok = diverged === 0 && (slope === null || slope < 30) && Object.keys(stats.failures).length === 0
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
process.exit(summary.ok ? 0 : 1)
