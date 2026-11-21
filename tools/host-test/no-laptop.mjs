#!/usr/bin/env node
/**
 * No laptop needed (#962, step 6): everything a band does through its host, against **a tablet as the only host**.
 * This script plays a phone - an HTTP client with no database of its own - and talks to the host URL it is given:
 *
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 node tools/host-test/no-laptop.mjs --host https://192.168.178.179:8443
 *
 * It founds a band on the host, lists, renames, reads and rotates the access code, writes and reads documents through the
 * host's `/db` (with a real PouchDB replicating both ways), founds a second band (refused without an admin proof, accepted
 * with one), blocks a device, deletes a band and checks it is never founded again, and asks for jobs a tablet does not do
 * (they must answer 501 with the missing capability - never 404). Every check prints PASS or FAIL; exit code 1 on any FAIL.
 *
 * What it does not claim: it is one laptop playing a phone over WiFi. Audio, clock and a real second phone stay
 * "needs device verification". It never types a PIN: the logins it uses are the ones the host hands out when a band is founded.
 * It does leave the bands it founded on the host (the deleted one stays deleted) - run it against a test host.
 */
import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import MemoryAdapter from 'pouchdb-adapter-memory'
import Replication from 'pouchdb-replication'

PouchDB.plugin(HttpAdapter).plugin(MemoryAdapter).plugin(Replication)

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const host = arg('host', '').replace(/\/+$/, '')
if (!host) {
  console.error('usage: no-laptop.mjs --host https://<tablet>:8443')
  process.exit(2)
}
const run = Date.now().toString(36)
const bandA = `nolaptop-a-${run}`
const bandB = `nolaptop-b-${run}`
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`)
  return ok
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
const brief = (value) => JSON.stringify(value)?.slice(0, 160)

// ---- who the host is -------------------------------------------------------------------------------------------
const caps = await call('GET', '/host/capabilities')
check('GET /host/capabilities answers (any host)', caps.status === 200 && caps.body?.kind, `kind=${caps.body?.kind} cores=${caps.body?.cpuCores ?? '?'} memoryMb=${caps.body?.memoryMb ?? '?'}`)
check('GET /health', (await call('GET', '/health')).status === 200)
const info = await call('GET', '/server-info')
check('GET /server-info', info.status === 200 && info.body?.port, brief(info.body))

// ---- jobs the device cannot do: 501 with the capability, never 404 -------------------------------------------------
for (const [method, path, capability] of [
  ['POST', '/server/backup/run', 'backup'],
  ['GET', '/speech?text=hallo', 'speech'],
  ['GET', '/lookup/ultimate-guitar/search?q=x', 'lookup'],
  ['POST', '/plugins/stem-separation/trigger', 'plugin:stem-separation'],
]) {
  const answered = await call(method, path, method === 'POST' ? {} : undefined)
  const isCapable = caps.body?.kind === 'desktop'
  if (isCapable) continue
  check(`${method} ${path} is refused for what the device lacks`, answered.status === 501 && answered.body?.error === 'capability_missing' && answered.body?.capability === capability, `status=${answered.status} ${brief(answered.body)}`)
}

// ---- found a band (the first one on a host needs no proof) ------------------------------------------------------------
const founded = await call('POST', '/workspaces', { workspaceId: bandA, founderId: 'f1', workspaceName: 'No laptop A', deviceId: 'phone-1' })
const founderOk = check('a phone founds a band on the tablet host', founded.status === 201 && founded.body?.username, `status=${founded.status} ${founded.status === 201 ? '' : brief(founded.body)}`)
if (!founderOk) process.exit(1)
const admin = { adminUsername: founded.body.username, adminPassword: founded.body.password }
const auth = { Authorization: basic(admin.adminUsername, admin.adminPassword) }

const listed = await call('GET', '/workspaces')
check('the band is listed', listed.status === 200 && JSON.stringify(listed.body).includes(bandA), brief(listed.body))

// ---- name and access code ---------------------------------------------------------------------------------------------
check('rename', (await call('POST', `/workspaces/${bandA}/name`, { ...admin, name: 'No laptop A (renamed)' })).status < 300)
check('the new name is listed', JSON.stringify((await call('GET', '/workspaces')).body).includes('renamed'))
const before = await call('POST', `/workspaces/${bandA}/access-code`, admin)
check('read the access code', before.status === 200 && typeof before.body?.code === 'string', `code ${before.body?.code ? 'present' : 'missing'}`)
const rotated = await call('POST', `/workspaces/${bandA}/access-code/rotate`, admin)
check('rotate the access code', rotated.status === 200 && rotated.body?.code && rotated.body.code !== before.body?.code)
check('a wrong login cannot read the code', (await call('POST', `/workspaces/${bandA}/access-code`, { adminUsername: 'nobody', adminPassword: 'x' })).status >= 400)

// ---- data: write through /db from one client, read from another ------------------------------------------------------------
const remote = new PouchDB(`${host}/db/stageboard-${bandA}`, { auth: { username: admin.adminUsername, password: admin.adminPassword }, fetch: (i, o) => globalThis.fetch(i, o) })
const one = new PouchDB(`one-${run}`, { adapter: 'memory' })
const two = new PouchDB(`two-${run}`, { adapter: 'memory' })
try {
  await one.put({ _id: 'songs:tnt', title: 'TNT' })
  const pushed = await one.replicate.to(remote)
  check('a phone writes a song to the tablet host', pushed.ok && pushed.docs_written >= 1, `written=${pushed.docs_written}`)
  const pulled = await two.replicate.from(remote)
  check('another phone reads it from the tablet host', pulled.ok && (await two.get('songs:tnt').catch(() => null))?.title === 'TNT')
} catch (err) {
  check('sync through the host database', false, String(err?.message ?? err))
}
const noLogin = await fetch(`${host}/db/stageboard-${bandA}/_all_docs`)
check('the band database refuses a request without a login', noLogin.status === 401, `status=${noLogin.status}`)

// ---- live channels (#962, step 2) --------------------------------------------------------------------------------------------
const health = await call('POST', `/plugin-health/${bandA}/report`, { pluginName: 'midi', status: 'online' })
check('a plugin-health report is taken', health.status === 204, `status=${health.status}`)
check('plugin-health report for a band the host does not serve is 404', (await call('POST', '/plugin-health/not-a-band-here/report', { pluginName: 'midi', status: 'online' })).status === 404)
check('a bad plugin-health report is 400', (await call('POST', `/plugin-health/${bandA}/report`, { nonsense: 1 })).status === 400)
const trigger = await call('POST', `/workspaces/${bandA}/devices/nobody/trigger`, { capability: 'lighting', event: { type: 'cue' } })
check('a device trigger for a device that is not connected says so (200 error), not 404', trigger.status === 200 && trigger.body?.status === 'error', brief(trigger.body))
check('Discovery starts', (await call('POST', `/workspaces/${bandA}/discovery/start`, { startedBy: 'nolaptop' })).status === 200)
check('Discovery stops', (await call('POST', `/workspaces/${bandA}/discovery/stop`, {})).status === 200)
const push = { deviceId: 'phone-1', issuedAt: Date.now(), patch: { playbackStatus: 'playing' } }
check('a show-state push without a login is refused', (await call('POST', `/workspaces/${bandA}/show-state/push`, push)).status === 401)
// A device listening on the stream gets what another pushes - relayed by the tablet's native server.
const abort = new AbortController()
const received = []
const listening = (async () => {
  try {
    const response = await fetch(`${host}/workspaces/${bandA}/show-state/stream`, { signal: abort.signal, headers: auth })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      received.push(decoder.decode(value))
      if (received.join('').includes('playing')) break
    }
  } catch {
    // aborted
  }
})()
await new Promise((resolve) => setTimeout(resolve, 800))
const pushed = await call('POST', `/workspaces/${bandA}/show-state/push`, push, auth)
check('a show-state push with the band login is taken', pushed.status === 204, `status=${pushed.status}`)
await Promise.race([listening, new Promise((resolve) => setTimeout(resolve, 3000))])
abort.abort()
check('a device listening on the stream receives it', received.join('').includes('playing'), `got ${received.join('').length} bytes`)
const discoveryStream = await fetch(`${host}/workspaces/${bandA}/discovery/stream`, { headers: auth }).catch(() => null)
check('a stream the tablet does not relay yet says which capability is missing (501), not 404', discoveryStream?.status === 501, `status=${discoveryStream?.status}`)
await discoveryStream?.body?.cancel().catch(() => undefined)

// ---- the invitation a primary sends a backup (#945, rules shared since #964) ---------------------------------------------------------------
const selfId = (await call('GET', '/time')).body?.hostId
const invite = { workspaceId: bandA, accessCode: '12345678', primaryUrl: 'https://10.255.255.1:8443', targetHostId: selfId, sentAt: Date.now() }
check('an invitation for another host is refused (400)', (await call('POST', '/host/join-band-invite', { ...invite, targetHostId: 'someone-else' })).status === 400)
check('an invitation for a band this tablet does not hold is refused before anyone is asked (409)', (await call('POST', '/host/join-band-invite', { ...invite, workspaceId: 'not-held-here' })).status === 409)
check('an invitation from the far future is refused (409)', (await call('POST', '/host/join-band-invite', { ...invite, sentAt: Date.now() + 3_600_000 })).status === 409)
check('a bad invitation body is refused (400)', (await call('POST', '/host/join-band-invite', { nonsense: true })).status === 400)

// ---- a second band: refused without proof, accepted with an admin of the first --------------------------------------------
const without = await call('POST', '/workspaces', { workspaceId: bandB, founderId: 'f2', workspaceName: 'No laptop B', deviceId: 'phone-1' })
check('a second band needs an admin proof (403)', without.status === 403, `status=${without.status}`)
const withProof = await call('POST', '/workspaces', { workspaceId: bandB, founderId: 'f2', workspaceName: 'No laptop B', deviceId: 'phone-1', ...admin })
check('with the proof the tablet holds a second band', withProof.status === 201, `status=${withProof.status}`)
const both = JSON.stringify((await call('GET', '/workspaces')).body)
check('both bands are listed', both.includes(bandA) && both.includes(bandB))
if (withProof.status === 201) {
  const adminB = { adminUsername: withProof.body.username, adminPassword: withProof.body.password }
  const remoteB = new PouchDB(`${host}/db/stageboard-${bandB}`, { auth: { username: adminB.adminUsername, password: adminB.adminPassword }, fetch: (i, o) => globalThis.fetch(i, o) })
  const info = await remoteB.info().catch(() => null)
  check('the second band has a database of its own on the tablet', info?.db_name?.includes(bandB) === true)
  const crossed = await fetch(`${host}/db/stageboard-${bandA}/_all_docs`, { headers: { Authorization: basic(adminB.adminUsername, adminB.adminPassword) } })
  check('the second band\'s login does not open the first band', crossed.status === 401 || crossed.status === 403, `status=${crossed.status}`)

  // ---- block a device (a Device Ledger entry of the band) --------------------------------------------------------------
  const ledger = new PouchDB(`${host}/db/stageboard-${bandB}`, { auth: { username: adminB.adminUsername, password: adminB.adminPassword }, fetch: (i, o) => globalThis.fetch(i, o) })
  await ledger.put({ _id: 'devices:old-phone', id: 'old-phone', name: 'Old phone', lastSeenAt: Date.now(), revoked: false }).catch(() => undefined)
  const blocked = await call('POST', `/workspaces/${bandB}/devices/old-phone/revoke`, { ...adminB, revoked: true })
  check('block a device', blocked.status < 300, `status=${blocked.status} ${blocked.status < 300 ? '' : brief(blocked.body)}`)
  const entry = await ledger.get('devices:old-phone').catch(() => null)
  check('the device is marked blocked in the band', entry?.revoked === true)

  // ---- delete: the band is gone from the list, never founded again ----------------------------------------------------------
  const deleted = await call('DELETE', `/workspaces/${bandB}`, adminB)
  check('delete the second band', deleted.status < 300, `status=${deleted.status} ${deleted.status < 300 ? '' : brief(deleted.body)}`)
  check('it is no longer listed', !JSON.stringify((await call('GET', '/workspaces')).body).includes(bandB))
  const again = await call('POST', '/workspaces', { workspaceId: bandB, founderId: 'f2', workspaceName: 'No laptop B', deviceId: 'phone-1', ...admin })
  check('a deleted band is never founded again (409)', again.status === 409, `status=${again.status}`)
}
const stillA = await remote.info().catch(() => null)
check('the first band is untouched by all of it', stillA?.db_name?.includes(bandA) === true)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
