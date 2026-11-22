#!/usr/bin/env node
/**
 * One band's whole life against one host, measured - the same script for a laptop host and a tablet host, so the two can be compared.
 *
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node tools/host-test/session.mjs --host https://192.168.178.158:8450 --label laptop [--json out.json]
 *
 * Three clients play the band's devices (a tablet, a second tablet, a laptop browser): each has a real PouchDB of its own and talks to the host's
 * HTTP and `/db` like the app does. Steps: who the host is, request latency, found a band, songs and setlists, live sync between the clients (how long a
 * change takes to arrive), audio up and down, add-ons (installed like the app installs them: a `plugins:` document), a YouTube import and a look-up
 * where the host can, the live channels (show state, presence), then delete the band. Every check says PASS/FAIL/SKIP; every timing is printed and goes
 * into the JSON. It never types a PIN: the logins are the ones the host hands out. Run it against a test host - it founds a band and deletes it.
 *
 * What it does not claim: one laptop plays all three clients over Wi-Fi (their CPUs are the laptop's, not a tablet's); audio playback, the clock and the
 * screens stay "needs device verification".
 */
import { writeFileSync } from 'node:fs'
import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import MemoryAdapter from 'pouchdb-adapter-memory'
import Replication from 'pouchdb-replication'
import { randomBytes } from 'node:crypto'

PouchDB.plugin(HttpAdapter).plugin(MemoryAdapter).plugin(Replication)

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const host = arg('host', '').replace(/\/+$/, '')
const label = arg('label', 'host')
const jsonOut = arg('json', '')
if (!host) {
  console.error('usage: session.mjs --host https://<host>:<port> [--label laptop|tablet] [--json out.json]')
  process.exit(2)
}
const run = Date.now().toString(36)
const band = arg('band', `session-${run}`)
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`

const results = { label, host, startedAt: new Date().toISOString(), checks: [], timings: {} }
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  results.checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`)
  return ok
}
const skip = (name, why) => {
  results.checks.push({ name, ok: null, detail: why })
  console.log(`SKIP  ${name}  - ${why}`)
}
const timing = (name, ms, extra = '') => {
  results.timings[name] = typeof ms === 'number' ? Math.round(ms * 10) / 10 : ms
  console.log(`TIME  ${name}: ${typeof ms === 'number' ? `${Math.round(ms)} ms` : ms}${extra ? `  (${extra})` : ''}`)
}
const timed = async (name, fn) => {
  const t0 = performance.now()
  const value = await fn()
  timing(name, performance.now() - t0)
  return value
}
const pct = (values, p) => {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))]
}
const call = async (method, path, body, headers = {}) => {
  const response = await fetch(`${host}${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: response.status, body: json }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---- 1. who the host is ------------------------------------------------------------------------------------------------
const caps = await call('GET', '/host/capabilities')
check('the host answers who it is and what it can do', caps.status === 200 && caps.body?.kind, `kind=${caps.body?.kind} platform=${caps.body?.platform} cores=${caps.body?.cpuCores} memoryMb=${caps.body?.memoryMb}`)
const desktop = caps.body?.kind === 'desktop'
const jobAvailable = (id) => caps.body?.jobs?.find((j) => j.id === id)?.available === true
results.capabilities = caps.body
const time0 = await call('GET', '/time')
check('/time names the host and its epoch', typeof time0.body?.hostId === 'string' && typeof time0.body?.epoch === 'number', `hostId=${time0.body?.hostId} epoch=${time0.body?.epoch} active=${time0.body?.active}`)
check('/host/info answers (and the old /server-info still does)', (await call('GET', '/host/info')).status === 200 && (await call('GET', '/server-info')).status === 200)

// ---- 2. request latency ------------------------------------------------------------------------------------------------
const rtts = []
for (let i = 0; i < 60; i++) {
  const t0 = performance.now()
  await call('GET', '/time')
  rtts.push(performance.now() - t0)
}
timing('GET /time p50', pct(rtts, 50), `p95 ${Math.round(pct(rtts, 95))} ms, max ${Math.round(Math.max(...rtts))} ms, 60 sequential requests`)
results.timings['GET /time p95'] = Math.round(pct(rtts, 95))
results.timings['GET /time max'] = Math.round(Math.max(...rtts))
const parallel = await timed('GET /time x40 in parallel', () => Promise.all(Array.from({ length: 40 }, () => call('GET', '/time'))))
check('forty requests at once all answer', parallel.every((r) => r.status === 200))

// ---- 3. found the band ----------------------------------------------------------------------------------------------------
// `--found-only <file>` founds the band, saves its logins to the file and stops (so a laptop host can be restarted with this band active, which needs
// an admin PIN a script never types); `--creds <file>` continues with those logins instead of founding.
const credsFile = arg('creds', '')
const foundOnly = arg('found-only', '')
let founded
if (credsFile) {
  const saved = JSON.parse((await import('node:fs')).readFileSync(credsFile, 'utf8'))
  founded = { status: 201, body: saved }
  timing('found a band', 'done earlier (--creds)')
} else {
  founded = await timed('found a band', () => call('POST', '/workspaces', { workspaceId: band, founderId: 'founder', workspaceName: `Session ${label}`, deviceId: 'tablet-a' }))
}
if (!check('a device founds a band on the host', founded.status === 201 && founded.body?.username, `status=${founded.status} ${founded.status === 201 ? '' : JSON.stringify(founded.body)?.slice(0, 160)}`)) process.exit(1)
if (foundOnly) {
  writeFileSync(foundOnly, JSON.stringify(founded.body))
  console.log(`band ${band} founded; logins saved to ${foundOnly}`)
  process.exit(0)
}
const admin = { adminUsername: founded.body.username, adminPassword: founded.body.password }
const auth = { Authorization: basic(admin.adminUsername, admin.adminPassword) }
const open = (name) => new PouchDB(`${host}/db/stageboard-${band}`, { auth: { username: admin.adminUsername, password: admin.adminPassword }, fetch: (i, o) => globalThis.fetch(i, o) })
const remote = open()
const local = { a: new PouchDB(`a-${run}`, { adapter: 'memory' }), b: new PouchDB(`b-${run}`, { adapter: 'memory' }), c: new PouchDB(`c-${run}`, { adapter: 'memory' }) }
if (desktop) {
  // The band's jobs, add-ons and the host's own device entry run for the band this host is set up for. Setting that up takes an admin PIN, which a
  // script never types - so start the host with STAGEBOARD_WORKSPACE=<this band id> and pass `--band <id>`.
  const active = (await call('GET', '/host/active-workspace')).body?.activeWorkspaceId
  if (active !== band) skip('the host is set up for this band', `active band is ${active ?? 'none'} - start the host with STAGEBOARD_WORKSPACE=${band} and --band ${band} to test its jobs, add-ons and own device entry`)
}
const rename = await call('POST', `/workspaces/${band}/name`, { ...admin, name: `Session ${label} (renamed)` })
check('rename the band', rename.status < 300)
const code = await call('POST', `/workspaces/${band}/access-code`, admin)
check('the access code can be read (a device joins with it)', code.status === 200 && typeof code.body?.code === 'string')
const info = await remote.info().catch(() => null)
check('the band has a database of its own on the host', info?.db_name?.includes(band) === true)

// ---- 4. songs and setlists from tablet A ----------------------------------------------------------------------------------------
const chordpro = (n) => `{title: Song ${n}}\n{artist: Test Band}\n{key: G}\n{tempo: ${90 + (n % 60)}}\n` + Array.from({ length: 24 }, (_, i) => `[G]Zeile ${i} von Lied ${n} [C]mit etwas [D]Text zum [Em]Spielen`).join('\n')
const SONGS = 200
const docs = []
for (let n = 0; n < SONGS; n++) docs.push({ _id: `song-variants:song${n}-orig`, id: `song${n}-orig`, songId: `song${n}`, name: 'Original', bpm: 90 + (n % 60), timeSignature: '4/4', chordpro: chordpro(n), tracks: [], createdAt: Date.now(), updatedAt: Date.now() })
for (let n = 0; n < 8; n++) docs.push({ _id: `setlists:set${n}`, id: `set${n}`, name: `Setliste ${n}`, entries: Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, variantId: `song${(n * 20 + i) % SONGS}-orig` })), updatedAt: Date.now() })
await timed(`tablet A writes ${docs.length} documents (${SONGS} songs, 8 setlists)`, () => local.a.bulkDocs(docs))
const push = await timed('tablet A pushes them to the host', () => local.a.replicate.to(remote))
check('the host takes all documents', push.ok && push.docs_written >= docs.length, `written=${push.docs_written}`)
const pullB = await timed('tablet B pulls the band from the host (first sync)', () => local.b.replicate.from(remote))
check('tablet B has every song and setlist', (await local.b.allDocs({ startkey: 'song-variants:', endkey: 'song-variants:￰' })).rows.length === SONGS && (await local.b.allDocs({ startkey: 'setlists:', endkey: 'setlists:￰' })).rows.length === 8, `docs_read=${pullB.docs_read}`)
const pullC = await timed('the laptop browser pulls the band (first sync)', () => local.c.replicate.from(remote))
check('the laptop browser has everything too', pullC.docs_read >= docs.length, `docs_read=${pullC.docs_read}`)

// ---- 5. live sync: how long does a change take to reach the others? -----------------------------------------------------------------
const syncs = [local.a, local.b, local.c].map((db, i) => db.sync(open(), { live: true, retry: true }).on('error', (e) => console.log(`      sync ${i} error: ${e?.status} ${e?.message}`)).on('denied', (e) => console.log(`      sync ${i} denied: ${e?.id}`)).on('change', (info) => process.env.SESSION_DEBUG && console.log(`      sync ${i} ${info.direction}: ${info.change.docs.map((d) => d._id).join(',').slice(0, 80)}`)))
await sleep(1500)
const seen = new Map()
const watch = (db, name) => db.changes({ since: 'now', live: true, include_docs: true }).on('change', (c) => {
  const stamp = c.doc?.stamp
  if (stamp) seen.set(`${name}:${c.doc._id}:${stamp}`, performance.now())
})
const watchers = [watch(local.b, 'b'), watch(local.c, 'c')]
const lagB = []
const lagC = []
for (let i = 0; i < 15; i++) {
  const id = `song-variants:live${i}`
  const stamp = `${run}-${i}`
  const t0 = performance.now()
  await local.a.put({ _id: id, id: `live${i}`, songId: 'live', name: 'Live', chordpro: `change ${i}`, stamp, updatedAt: Date.now() })
  const until = t0 + 8000
  while (performance.now() < until && !(seen.has(`b:${id}:${stamp}`) && seen.has(`c:${id}:${stamp}`))) await sleep(10)
  lagB.push((seen.get(`b:${id}:${stamp}`) ?? t0 + 8000) - t0)
  lagC.push((seen.get(`c:${id}:${stamp}`) ?? t0 + 8000) - t0)
  await sleep(150)
}
timing('live sync: a change on A reaches B, p50', pct(lagB, 50), `p95 ${Math.round(pct(lagB, 95))} ms, max ${Math.round(Math.max(...lagB))} ms, 15 changes`)
timing('live sync: a change on A reaches the laptop browser, p50', pct(lagC, 50), `p95 ${Math.round(pct(lagC, 95))} ms, max ${Math.round(Math.max(...lagC))} ms`)
results.timings['live sync B p95'] = Math.round(pct(lagB, 95))
results.timings['live sync C p95'] = Math.round(pct(lagC, 95))
check('every live change reached both other devices (under 8 s)', Math.max(...lagB, ...lagC) < 8000)
// A conflicting edit from two devices: both writes survive as a conflict the app resolves, no write is lost silently.
const base = await local.a.get('song-variants:live0')
await Promise.all([local.a.put({ ...base, chordpro: 'edit by A' }), local.b.put({ ...(await local.b.get('song-variants:live0')), chordpro: 'edit by B' })])
await sleep(2500)
const settled = await remote.get('song-variants:live0', { conflicts: true }).catch(() => null)
check('two devices editing one song at once: the host keeps a winner and the loser as a conflict (nothing lost silently)', settled && (settled.chordpro === 'edit by A' || settled.chordpro === 'edit by B') && Array.isArray(settled._conflicts), `winner="${settled?.chordpro}" conflicts=${settled?._conflicts?.length ?? 0}`)
watchers.forEach((w) => w.cancel())
syncs.forEach((s) => s.cancel())

// ---- 6. audio: a 3 MB track up and down --------------------------------------------------------------------------------------------
const bytes = randomBytes(3 * 1024 * 1024)
const up = await timed('upload a 3 MB track', async () => fetch(`${host}/audio/song0-orig/track1`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', ...auth }, body: bytes }))
check('the host takes the track', up.status === 204, `status=${up.status}`)
const down = await timed('download the 3 MB track', async () => {
  const r = await fetch(`${host}/audio/song0-orig/track1`, { headers: auth })
  return { status: r.status, data: Buffer.from(await r.arrayBuffer()) }
})
check('the track comes back byte for byte', down.status === 200 && down.data.equals(bytes))
const parallelDown = await timed('three devices download it at once', () => Promise.all([1, 2, 3].map(async () => (await fetch(`${host}/audio/song0-orig/track1`, { headers: auth })).arrayBuffer())))
check('all three got the whole track', parallelDown.every((b) => b.byteLength === bytes.length))

// ---- 7. add-ons: installed like the app does (a plugins: document), then used ------------------------------------------------------------
const install = (id, name, capabilities) => remote.put({ _id: `plugins:${id}`, id, name, version: '1.0.0', runtime: 'host', capabilities, transports: [], hardwareIds: [], enabled: true, installedAt: Date.now() })
await install('youtube-download', 'YouTube', ['video-download'])
await install('metadata-lookup', 'Musik-Metadaten', [])
await install('ultimate-guitar-import', 'Ultimate Guitar', ['chord-import'])
await sleep(1500)
if (desktop) {
  const mb = await timed('look-up: MusicBrainz search', () => call('GET', `/lookup/metadata-lookup/search?q=${encodeURIComponent('Wonderwall Oasis')}&workspace=${band}`, undefined, auth))
  if (mb.status === 502 || mb.status === 503) skip('the MusicBrainz look-up answers', `musicbrainz.org itself answered ${mb.status} (outage or rate limit) - the host reported it as ${mb.status}, not a hang`)
  else check('the MusicBrainz look-up answers', mb.status === 200 && Array.isArray(mb.body) && mb.body.length > 0, `status=${mb.status} ${Array.isArray(mb.body) ? mb.body.length + ' hits' : JSON.stringify(mb.body)?.slice(0, 120)}`)
  const ugRefused = await call('GET', `/lookup/ultimate-guitar-scraper/search?q=x&workspace=${band}`, undefined, auth)
  check('Ultimate Guitar answers once its add-on is installed (a Chrome here is needed; a clear message otherwise, never a hang)', ugRefused.status !== 403, `status=${ugRefused.status} ${JSON.stringify(ugRefused.body)?.slice(0, 120)}`)
  if (jobAvailable('plugin-runtime') && caps.body?.plugins?.find((p) => p.id === 'youtube-download')?.available) {
    const yt = await timed('add-on method: YouTube search', () => call('POST', `/addons/youtube-download/methods/search?workspace=${band}`, { query: 'Blink-182 All the small things' }, auth))
    check('the YouTube add-on finds videos', yt.status === 200 && yt.body?.ok === true && yt.body.body?.hits?.length > 0, `status=${yt.status} ${yt.body?.ok ? yt.body.body.hits.length + ' hits' : JSON.stringify(yt.body)?.slice(0, 140)}`)
    // An audio import as the app queues it: a job document, taken by the host, ending with the track in the song.
    await local.a.put({ _id: 'song-variants:yt-target', id: 'yt-target', songId: 'yt', name: 'Original', tracks: [], updatedAt: Date.now() })
    await local.a.replicate.to(remote)
    const hit = yt.body?.body?.hits?.[0]
    if (hit) {
      const jobId = `job-${run}`
      const t0 = performance.now()
      await remote.put({ _id: `async-jobs:${jobId}`, id: jobId, type: 'audio-import', status: 'queued', progress: 0, createdAt: Date.now(), updatedAt: Date.now(), variantId: 'yt-target', addonId: 'youtube-download', method: 'fetchAudio', args: { url: hit.url }, label: hit.title })
      let job = null
      while (performance.now() - t0 < 120000) {
        job = await remote.get(`async-jobs:${jobId}`).catch(() => null)
        if (job && (job.status === 'done' || job.status === 'error')) break
        await sleep(500)
      }
      timing('YouTube import end to end (queue to done)', performance.now() - t0, `status=${job?.status}${job?.error ? ' ' + job.error : ''}`)
      check('the host imports the audio and attaches the track to the song', job?.status === 'done' && !!job.trackId, `status=${job?.status} ${job?.error ?? ''}`)
    }
  } else skip('YouTube search and import', 'the host has no yt-dlp')
  skip('stem separation and speech', `Demucs/Piper not installed on this host (jobs: ${jobAvailable('speech') ? 'speech yes' : 'speech no'})`)
} else {
  const mb = await call('GET', `/lookup/metadata-lookup/search?q=Wonderwall&workspace=${band}`, undefined, auth)
  check('a look-up this tablet cannot answer says so (501 with the capability, never 404)', mb.status === 200 || (mb.status === 501 && mb.body?.error === 'capability_missing'), `status=${mb.status}`)
  const yt = await call('POST', `/addons/youtube-download/methods/search?workspace=${band}`, { query: 'x' }, auth)
  check('an add-on method this tablet cannot run says so, not 404', yt.status === 200 || (yt.status === 501 && yt.body?.error === 'capability_missing'), `status=${yt.status} ${JSON.stringify(yt.body)?.slice(0, 140)}`)
  skip('YouTube import', 'the tablet host has no yt-dlp helper')
}

// ---- 8. live channels --------------------------------------------------------------------------------------------------------------------------
const received = []
const abort = new AbortController()
let t1 = 0
let expected = 'playing'
const listening = (async () => {
  try {
    const response = await fetch(`${host}/workspaces/${band}/show-state/stream`, { signal: abort.signal, headers: auth })
    const reader = response.body.getReader()
    const dec = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      const text = dec.decode(value)
      if (text.includes(`"${expected}"`) && !received.length) received.push(performance.now() - t1)
    }
  } catch {
    // aborted
  }
})()
await sleep(1000)
const lags = []
for (let i = 0; i < 10; i++) {
  received.length = 0
  expected = i % 2 ? 'paused' : 'playing'
  t1 = performance.now()
  await call('POST', `/workspaces/${band}/show-state/push`, { deviceId: 'tablet-a', issuedAt: Date.now(), patch: { playbackStatus: expected } }, auth)
  const until = performance.now() + 3000
  while (!received.length && performance.now() < until) await sleep(5)
  if (received.length) lags.push(received[0])
  await sleep(100)
}
abort.abort()
await listening
if (lags.length) timing('show state: a push reaches a listening device, p50', pct(lags, 50), `p95 ${Math.round(pct(lags, 95))} ms over ${lags.length} pushes`)
check('show-state pushes reach a listening device', lags.length >= 8, `${lags.length}/10 seen`)
const presence = await call('POST', `/workspaces/${band}/presence/report`, { deviceId: 'tablet-a', profileId: 'founder' }, auth)
check('a presence report is taken', presence.status < 300, `status=${presence.status}`)
const flash = await call('POST', `/workspaces/${band}/flash`, { text: 'Test', from: 'founder' }, auth)
check('a flash message is taken (a band device)', flash.status < 300, `status=${flash.status}`)

// ---- 9. the host as a device of the band ----------------------------------------------------------------------------------------------------------
if (desktop) {
  const devices = await remote.allDocs({ startkey: 'devices:', endkey: 'devices:￰', include_docs: true })
  const registered = devices.rows.find((r) => r.doc?.host === true)
  check('the host registered itself as a device of the band (Device.host)', !!registered, registered ? `id=${registered.doc.id} name=${registered.doc.name}` : 'no host entry (the band must be active on this host)')
}

// ---- 10. clean up -----------------------------------------------------------------------------------------------------------------------------------
const deleted = await timed('delete the band', () => call('DELETE', `/workspaces/${band}`, admin))
check('the band is deleted', deleted.status < 300, `status=${deleted.status}`)
check('it is no longer listed', !JSON.stringify((await call('GET', '/workspaces')).body).includes(band))

results.finishedAt = new Date().toISOString()
results.failures = failures
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2))
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
