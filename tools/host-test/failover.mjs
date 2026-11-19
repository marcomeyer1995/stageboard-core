#!/usr/bin/env node
/**
 * Two tablets, no laptop: host failover (#962). A band lives on a primary tablet and a backup tablet; the primary is
 * stopped; the backup must take over and serve the band with the logins the primary handed out; the primary comes back.
 *
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node tools/host-test/failover.mjs --primary Fire --backup Redmi
 *
 * Names come from tools/devices.json. It uses the isolated test app (de.stageboard.app.dev.test, built with
 * -PstageboardAppIdSuffix=.dev.test, installed on both) and CLEARS ITS DATA on both devices - never the real dev app. The
 * laptop only plays the admin's phone: it founds the band over HTTP, writes the band's host list and a song, and reads. It
 * never types a PIN. Every check prints PASS/FAIL; exit 1 on any FAIL.
 *
 * What it does not claim: WiFi of one router, two devices, one run. Audio and the beat across a takeover are not measured here.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import Replication from 'pouchdb-replication'

PouchDB.plugin(HttpAdapter).plugin(Replication)

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const devices = JSON.parse(readFileSync(new URL('../devices.json', import.meta.url), 'utf8'))
const named = (name) => {
  const d = devices.find((x) => x.name === name)
  if (!d) throw new Error(`no device ${name} in tools/devices.json`)
  return d
}
const primary = named(arg('primary', 'Fire'))
const backup = named(arg('backup', 'Redmi'))
const PKG = 'de.stageboard.app.dev.test'
const MAIN = `${PKG}/de.stageboard.app.MainActivity`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const adb = (d, ...args) => execFileSync('adb', ['-s', d.serial, ...args], { encoding: 'utf8', timeout: 60_000 }).trim()
const cdp = (d, expr, timeout = 30_000) => {
  const out = execFileSync('node', ['tools/cdp/cdp.mjs', 'eval', d.name, expr, String(timeout)], { encoding: 'utf8', env: { ...process.env, STAGEBOARD_DEV_APP: PKG }, timeout: timeout + 30_000 }).trim().split('\n').pop()
  try {
    return JSON.parse(out)
  } catch {
    return out
  }
}
let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`)
  return ok
}
const call = async (url, path, init = {}) => {
  const response = await fetch(`${url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(8000) })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: response.status, body }
}
const basic = (u, p) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`
const urlOf = async (d) => {
  const ip = adb(d, 'shell', 'ip', '-o', '-4', 'addr', 'show', 'wlan0').match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1]
  if (!ip) throw new Error(`no WiFi address on ${d.name}`)
  return `https://${ip}:8443`
}

console.log(`primary ${primary.name}, backup ${backup.name}`)
const run = Date.now().toString(36)
const band = `failover-${run}`

// ---- 1. both apps empty, host switch on ---------------------------------------------------------------------------------------
for (const d of [primary, backup]) {
  adb(d, 'shell', 'pm', 'clear', PKG)
  adb(d, 'shell', 'am', 'start', '-n', MAIN)
}
await sleep(9000)
for (const d of [primary, backup]) cdp(d, "localStorage.setItem('stageboard-android-host','on'); location.reload(); 'ok'")
await sleep(14000)
const P = await urlOf(primary)
const B = await urlOf(backup)
const pTime = await call(P, '/time').catch(() => null)
const bTime = await call(B, '/time').catch(() => null)
if (!check('both tablets answer as hosts with no band', pTime?.status === 200 && bTime?.status === 200, `${P} ${B}`)) process.exit(1)
const pInfo = (await call(P, '/server-info')).body
const bInfo = (await call(B, '/server-info')).body
const pId = pTime.body.hostId
const bId = bTime.body.hostId

// ---- 2. the band: founded on the primary, a member profile, the host list ------------------------------------------------------
const founded = await call(P, '/workspaces', { method: 'POST', body: JSON.stringify({ workspaceId: band, founderId: 'f1', workspaceName: 'Failover', deviceId: 'phone-admin' }) })
if (!check('the band is founded on the primary tablet', founded.status === 201)) process.exit(1)
const admin = { username: founded.body.username, password: founded.body.password }
const adminAuth = { Authorization: basic(admin.username, admin.password) }
const db = (url, creds) => new PouchDB(`${url}/db/stageboard-${band}`, { auth: creds, fetch: (i, o) => globalThis.fetch(i, o) })
const onP = db(P, admin)
await onP.put({ _id: 'profiles:f1', id: 'f1', name: 'Founder', stageRoles: ['admin'] })
await onP.put({ _id: 'profiles:m2', id: 'm2', name: 'Member', stageRoles: [] })
const code = (await call(P, `/workspaces/${band}/access-code`, { method: 'POST', body: JSON.stringify({ adminUsername: admin.username, adminPassword: admin.password }) })).body?.code
await onP.put({
  _id: 'band-settings:band',
  id: 'band',
  hosts: [
    { hostId: pId, url: P, certFingerprint: pInfo.certFingerprint, priority: 1 },
    { hostId: bId, url: B, certFingerprint: bInfo.certFingerprint, priority: 2 },
  ],
})
await onP.put({ _id: 'songs:first', title: 'Before the failover' })
check('the band holds its host list, a profile and a song on the primary', (await onP.get('band-settings:band').catch(() => null))?.hosts?.length === 2)

// ---- 3. the backup tablet joins the band as a device and syncs it ------------------------------------------------------------------
const joined = await call(P, `/workspaces/${band}/join/m2`, { method: 'POST', body: JSON.stringify({ code, deviceId: `backup-${run}` }) })
check('the backup tablet gets its own login from the primary', joined.status === 200 || joined.status === 201)
const seed = (d, workspace, hostUrl, fingerprint, hostPin) => {
  const state = JSON.stringify({ state: { workspaces: [workspace], activeWorkspaceId: band }, version: 1 })
  const profile = JSON.stringify({ state: { byWorkspace: { [band]: workspace.ownProfileId ?? 'm2' } }, version: 0 })
  const host = JSON.stringify({ state: { url: hostUrl }, version: 0 })
  return cdp(
    d,
    `(async()=>{localStorage.setItem('stageboard-workspaces',${JSON.stringify(state)});localStorage.setItem('stageboard-active-profile',${JSON.stringify(profile)});` +
      (hostUrl ? `localStorage.setItem('stageboard-host-url',${JSON.stringify(host)});` : '') +
      (hostPin ? `await window.Capacitor.Plugins.ServerTrust.pin(${JSON.stringify(hostPin)});` : '') +
      `localStorage.setItem('stageboard-android-host','on');location.reload();return 'seeded'})()`,
  )
}
// Primary: the band is its own (founded on it), no server to sync with.
console.log(seed(primary, { id: band, name: 'Failover', username: admin.username, password: admin.password, isAdmin: true, ownProfileId: 'f1' }, null, null, null))
// Backup: a member of the band, syncing it from the primary; it trusts the primary's certificate by fingerprint.
console.log(seed(backup, { id: band, name: 'Failover', username: joined.body.username, password: joined.body.password, isAdmin: false }, P, pInfo.certFingerprint, { host: new URL(P).host, fingerprint: pInfo.certFingerprint }))
await sleep(25000)
const backupHasBand = await (async () => {
  const names = cdp(backup, "(async()=>JSON.stringify((await indexedDB.databases()).map(d=>d.name)))()")
  return String(names).includes(`stageboard-${band}`)
})()
check('the backup tablet holds a local copy of the band', backupHasBand)

// ---- 4. before: the primary is the band host, the backup is passive and receives the lease ------------------------------------------------
let pNow, bNow
for (let i = 0; i < 12; i++) {
  pNow = (await call(P, '/time').catch(() => null))?.body
  bNow = (await call(B, '/time').catch(() => null))?.body
  if (pNow?.active === true) break
  await sleep(3000)
}
check('before: the primary tablet is the band host (active)', pNow?.active === true, JSON.stringify(pNow))
check('before: the backup tablet is passive', bNow?.active === false, JSON.stringify(bNow))
const lease = (await call(B, '/server/host-lease').catch(() => null))?.body
check('before: the backup has received the primary\'s lease', lease?.lease?.hostId === pId && lease?.lease?.alive === true, JSON.stringify(lease?.lease))
check('before: the backup refuses the band\'s data while passive (503)', (await call(B, `/db/stageboard-${band}/_all_docs`, { headers: adminAuth })).status === 503)
const epochBefore = bNow?.epoch

// ---- 5. the primary stops ---------------------------------------------------------------------------------------------------------
const stoppedAt = Date.now()
adb(primary, 'shell', 'am', 'force-stop', PKG)
let took = null
for (let i = 0; i < 40; i++) {
  await sleep(1000)
  const t = (await call(B, '/time').catch(() => null))?.body
  if (t?.active === true) {
    took = { afterMs: Date.now() - stoppedAt, epoch: t.epoch }
    break
  }
}
check('the backup tablet takes over after the primary stops', took !== null, took ? `after ${(took.afterMs / 1000).toFixed(1)} s, epoch ${epochBefore} -> ${took.epoch}` : 'never within 40 s')
check('the epoch went up on the takeover', took !== null && took.epoch > (epochBefore ?? 0))

// ---- 6. the backup serves the band with the logins the primary handed out ------------------------------------------------------------------
await sleep(1500)
const asAdmin = await call(B, `/db/stageboard-${band}/songs:first`, { headers: adminAuth })
check('the primary\'s admin login works on the backup (accounts are the band\'s own documents)', asAdmin.status === 200 && asAdmin.body?.title === 'Before the failover', `status=${asAdmin.status}`)
const onB = db(B, admin)
let wrote = false
try {
  await onB.put({ _id: 'songs:during', title: 'During the failover' })
  wrote = true
} catch (err) {
  console.log('write failed:', err?.status ?? err?.message)
}
check('a phone writes a song through the backup while the primary is down', wrote)
check('a stranger is still refused on the backup', (await call(B, `/db/stageboard-${band}/_all_docs`)).status === 401)

// ---- 7. the primary comes back ------------------------------------------------------------------------------------------------------------
adb(primary, 'shell', 'am', 'start', '-n', MAIN)
let back = null
const backAt = Date.now()
for (let i = 0; i < 40; i++) {
  await sleep(3000)
  const t = (await call(P, '/time').catch(() => null))?.body
  if (t?.hostId) {
    back = t
    break
  }
}
check('the primary tablet comes back as a host', back !== null, JSON.stringify(back))
let settled = null
for (let i = 0; i < 40; i++) {
  await sleep(3000)
  const p = (await call(P, '/time').catch(() => null))?.body
  const b = (await call(B, '/time').catch(() => null))?.body
  if (p?.active === true && b?.active === false) {
    settled = { afterMs: Date.now() - backAt, p, b }
    break
  }
  if (i === 39) settled = null
}
check('after a steady period the band is handed back: primary active, backup passive', settled !== null, settled ? `after ${(settled.afterMs / 1000).toFixed(0)} s, epochs ${settled.p.epoch}/${settled.b.epoch}` : 'not within about 2 min')
if (settled) {
  const during = await call(P, `/db/stageboard-${band}/songs:during`, { headers: adminAuth })
  check('what was written during the takeover is on the primary after the handback', during.status === 200, `status=${during.status}`)
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
