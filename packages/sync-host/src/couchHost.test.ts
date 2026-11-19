import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import MemoryAdapter from 'pouchdb-adapter-memory'
import Replication from 'pouchdb-replication'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBandAccounts, type AccountDoc, type AccountStore } from './host/bandAccounts.js'
import { createCouchHost, type Catalog, type CouchHostRequest } from './couchHost.js'

PouchDB.plugin(HttpAdapter).plugin(MemoryAdapter).plugin(Replication)

// The validator the Stage-Server writes into every band (core-backend workspaceProvisioning.ts).
const ROSTER = `function(newDoc, oldDoc, userCtx) {
  var isAdmin = userCtx.roles.indexOf('admin') !== -1 || userCtx.roles.indexOf('_admin') !== -1;
  if (newDoc._id.indexOf('profiles:') === 0 && !isAdmin) {
    throw({forbidden: 'Only a band admin may edit the roster.'});
  }
  if ((newDoc._id.indexOf('account:') === 0 || newDoc._id.indexOf('anchor:') === 0) && userCtx.roles.indexOf('_admin') === -1 && userCtx.roles.indexOf('host') === -1) {
    throw({forbidden: 'Only a host writes the band accounts.'});
  }
}`

let n = 0
let web: { server: Server; url: string }

beforeEach(async () => {
  const names = new Set<string>()
  const catalog: Catalog = { list: async () => [...names], add: async (x) => void names.add(x), remove: async (x) => void names.delete(x) }
  const prefix = `t${++n}-`
  const handler = createCouchHost({ storage: (name) => new PouchDB(prefix + name, { adapter: 'memory' }), catalog, admin: { user: 'admin', password: 'secret' }, longpollMaxMs: 2000 })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks)
    const type = req.headers['content-type'] ?? ''
    const body = raw.length === 0 ? undefined : type.includes('json') ? JSON.parse(raw.toString('utf8')) : { data: new Uint8Array(raw), contentType: type }
    const request: CouchHostRequest = { method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body, authorization: req.headers.authorization }
    const out = await handler(request)
    res.writeHead(out.status, { 'content-type': out.binary?.contentType ?? 'application/json' })
    res.end(out.binary ? Buffer.from(out.binary.data) : JSON.stringify(out.body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  web = { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
})

afterEach(async () => {
  await new Promise<void>((resolve) => web.server.close(() => resolve()))
})

const auth = (user: string, password: string) => ({ Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`, 'Content-Type': 'application/json' })
const admin = auth('admin', 'secret')
const call = (path: string, init: RequestInit = {}) => fetch(`${web.url}${path}`, init)

/** A band the way core-backend founds one: database, member account, access rules, validator. */
async function foundBand() {
  expect((await call('/stageboard-band', { method: 'PUT', headers: admin })).status).toBe(201)
  expect((await call('/stageboard-band', { method: 'PUT', headers: admin })).status).toBe(412)
  await call('/_users/org.couchdb.user:kai', { method: 'PUT', headers: admin, body: JSON.stringify({ _id: 'org.couchdb.user:kai', name: 'kai', password: 'pin-1234', roles: ['member'], type: 'user' }) })
  await call('/_users/org.couchdb.user:marco', { method: 'PUT', headers: admin, body: JSON.stringify({ _id: 'org.couchdb.user:marco', name: 'marco', password: 'pin-9999', roles: ['member', 'admin'], type: 'user' }) })
  await call('/stageboard-band/_security', { method: 'PUT', headers: admin, body: JSON.stringify({ members: { names: [], roles: ['member'] } }) })
  await call('/stageboard-band/_design/roster', { method: 'PUT', headers: admin, body: JSON.stringify({ validate_doc_update: ROSTER }) })
}

describe('couch-host: a small CouchDB for the Stage-Server without Docker (docs/25)', () => {
  it('accounts: the login check knows the right password and the roles; the stored account has no password', async () => {
    await foundBand()
    const ok = await (await call('/_session', { headers: auth('kai', 'pin-1234') })).json()
    expect(ok.userCtx).toEqual({ name: 'kai', roles: ['member'] })
    expect((await call('/_session', { headers: auth('kai', 'wrong') })).status).toBe(401)
    const stored = await (await call('/_users/org.couchdb.user:kai', { headers: admin })).json()
    expect(stored.password).toBeUndefined()
    expect(stored.derived_key).toMatch(/^[0-9a-f]{64}$/)
    // A member can't read the accounts.
    expect((await call('/_users/org.couchdb.user:kai', { headers: auth('kai', 'pin-1234') })).status).toBe(403)
  })

  it('only members sync the band: a stranger and a wrong password are turned away', async () => {
    await foundBand()
    await call('/_users/org.couchdb.user:stranger', { method: 'PUT', headers: admin, body: JSON.stringify({ name: 'stranger', password: 'x', roles: ['other'], type: 'user' }) })
    expect((await call('/stageboard-band', { headers: auth('kai', 'pin-1234') })).status).toBe(200)
    expect((await call('/stageboard-band', { headers: auth('stranger', 'x') })).status).toBe(403)
    expect((await call('/stageboard-band')).status).toBe(401)
    expect((await call('/stageboard-band/_local/_security', { method: 'PUT', headers: auth('kai', 'pin-1234'), body: JSON.stringify({ members: { roles: [] } }) })).status).toBe(403)
  })

  it("the band's validator holds, also for what arrives by replication: a member may not edit the roster, an admin may", async () => {
    await foundBand()
    const kai = await call('/stageboard-band/profiles:kai', { method: 'PUT', headers: auth('kai', 'pin-1234'), body: JSON.stringify({ name: 'Kai' }) })
    expect(kai.status).toBe(403)
    expect((await kai.json()).reason).toBe('Only a band admin may edit the roster.')
    const marco = await call('/stageboard-band/profiles:kai', { method: 'PUT', headers: auth('marco', 'pin-9999'), body: JSON.stringify({ name: 'Kai' }) })
    expect(marco.status).toBe(201)

    // A member's tablet replicates a song and a forged profile: the song lands, the profile not.
    const tablet = new PouchDB(`kai-tablet-${n}`, { adapter: 'memory' })
    await tablet.bulkDocs([{ _id: 'song:1', title: 'TNT' }, { _id: 'profiles:kai', name: 'Kai der Admin' }])
    const remote = new PouchDB(`${web.url}/stageboard-band`, { skip_setup: true, fetch: (url, opts) => PouchDB.fetch(url, { ...opts, headers: { ...Object.fromEntries(new Headers(opts?.headers)), ...auth('kai', 'pin-1234') } }) })
    await tablet.replicate.to(remote)
    const band = await (await call('/stageboard-band/_all_docs?include_docs=true', { headers: admin })).json()
    const byId = Object.fromEntries(band.rows.map((r: { id: string; doc: { name?: string; title?: string } }) => [r.id, r.doc]))
    expect(byId['song:1'].title).toBe('TNT')
    expect(byId['profiles:kai'].name).toBe('Kai')
  })

  it('the band list and deleting a band are for the server admin only', async () => {
    await foundBand()
    expect(await (await call('/_all_dbs', { headers: admin })).json()).toEqual(['stageboard-band'])
    expect((await call('/_all_dbs', { headers: auth('marco', 'pin-9999') })).status).toBe(403)
    expect((await call('/stageboard-band', { method: 'DELETE', headers: auth('marco', 'pin-9999') })).status).toBe(403)
    expect((await call('/stageboard-band', { method: 'DELETE', headers: admin })).status).toBe(200)
    expect(await (await call('/_all_dbs', { headers: admin })).json()).toEqual([])
  })
})

describe('accounts copied from CouchDB 3.5 (2026-11-07)', () => {
  it("an account in CouchDB's own format (PBKDF2-SHA256, 600,000 rounds, hex salt as text) logs in", async () => {
    const { pbkdf2Sync, randomBytes } = await import('node:crypto')
    const salt = randomBytes(16).toString('hex')
    const derived_key = pbkdf2Sync('pin-4711', salt, 600_000, 32, 'sha256').toString('hex')
    // As CouchDB stores it - copied over by replication, no password field.
    const doc = { _id: 'org.couchdb.user:copied', name: 'copied', roles: ['member'], type: 'user', password_scheme: 'pbkdf2', pbkdf2_prf: 'sha256', salt, iterations: 600_000, derived_key }
    await call('/_users/_bulk_docs', { method: 'POST', headers: admin, body: JSON.stringify({ docs: [{ ...doc, _rev: '1-abc' }], new_edits: false }) })
    const ok = await call('/_session', { headers: auth('copied', 'pin-4711') })
    expect((await ok.json()).userCtx).toEqual({ name: 'copied', roles: ['member'] })
    expect((await call('/_session', { headers: auth('copied', 'pin-0000') })).status).toBe(401)
    // The second request doesn't pay the 600,000 rounds again.
    const t0 = Date.now()
    await call('/_session', { headers: auth('copied', 'pin-4711') })
    expect(Date.now() - t0).toBeLessThan(50)
  })
})

describe('logins that live in the band database (#960)', () => {
  /** The band's accounts as the Stage-Server writes them: as the server admin, over the host's own protocol. */
  const storeOf = (band: string): AccountStore => ({
    get: async (id) => {
      const r = await call(`/${band}/${encodeURIComponent(id)}`, { headers: admin })
      return r.status === 200 ? ((await r.json()) as AccountDoc) : null
    },
    put: async (doc) => {
      const current = await call(`/${band}/${encodeURIComponent(doc._id)}`, { headers: admin })
      const rev = current.status === 200 ? ((await current.json()) as AccountDoc)._rev : undefined
      expect((await call(`/${band}/${encodeURIComponent(doc._id)}`, { method: 'PUT', headers: admin, body: JSON.stringify({ ...doc, ...(rev ? { _rev: rev } : {}) }) })).status).toBe(201)
    },
    list: async (prefix) => {
      const r = await call(`/${band}/_all_docs?include_docs=true&startkey=${encodeURIComponent(JSON.stringify(prefix))}&endkey=${encodeURIComponent(JSON.stringify(prefix + '\ufff0'))}`, { headers: admin })
      return ((await r.json()) as { rows: { doc: AccountDoc }[] }).rows.map((row) => row.doc)
    },
  })
  const bandAccounts = (band: string) => createBandAccounts({ store: storeOf(`stageboard-${band}`), workspaceId: band, iterations: 1000 })

  async function foundBands() {
    for (const band of ['band', 'other']) {
      expect((await call(`/stageboard-${band}`, { method: 'PUT', headers: admin })).status).toBe(201)
      await call(`/stageboard-${band}/_security`, { method: 'PUT', headers: admin, body: JSON.stringify({ members: { names: [], roles: ['member'] } }) })
      await call(`/stageboard-${band}/_design/roster`, { method: 'PUT', headers: admin, body: JSON.stringify({ validate_doc_update: ROSTER }) })
    }
  }
  const login = (u: { username: string; password: string }) => auth(u.username, u.password)

  it('lets a device with a login of the band into that band - and not into another band', async () => {
    await foundBands()
    const device = await bandAccounts('band').provisionDevice('p1', 'd1', false)
    expect((await call('/stageboard-band/_all_docs', { headers: login(device) })).status).toBe(200)
    expect((await call('/stageboard-other/_all_docs', { headers: login(device) })).status).toBe(401)
  })

  it('turns away a wrong password, a login nobody made, and one that was taken out', async () => {
    await foundBands()
    const accounts = bandAccounts('band')
    const device = await accounts.provisionDevice('p1', 'd1', false)
    expect((await call('/stageboard-band/_all_docs', { headers: auth(device.username, 'wrong') })).status).toBe(401)
    expect((await call('/stageboard-band/_all_docs', { headers: auth('stageboard-band-p1~ghost', device.password) })).status).toBe(401)
    await accounts.removeMember('p1')
    // a revoked login is turned away at once on a fresh host check (the remembered check lasts a few minutes)
    expect((await call('/stageboard-band/_all_docs', { headers: login(device) })).status).toBe(401)
  })

  it("holds the band's validator for them: an admin device edits the roster, a member device may not", async () => {
    await foundBands()
    const accounts = bandAccounts('band')
    const member = await accounts.provisionDevice('p1', 'd1', false)
    const boss = await accounts.provisionDevice('p2', 'd2', true)
    const write = (who: { username: string; password: string }) =>
      call('/stageboard-band/profiles:x', { method: 'PUT', headers: login(who), body: JSON.stringify({ _id: 'profiles:x', name: 'X' }) })
    expect((await write(member)).status).toBe(403)
    expect((await write(boss)).status).toBe(201)
  })

  it('does not let a plain login write the accounts themselves', async () => {
    await foundBands()
    const member = await bandAccounts('band').provisionDevice('p1', 'd1', false)
    const forged = await call('/stageboard-band/account:stageboard-band-p1~evil', { method: 'PUT', headers: login(member), body: JSON.stringify({ _id: 'account:stageboard-band-p1~evil', roles: ['member', 'admin'] }) })
    expect(forged.status).toBe(403)
  })

  it('still lets the old _users accounts in', async () => {
    await foundBand()
    expect((await call('/stageboard-band/_all_docs', { headers: auth('kai', 'pin-1234') })).status).toBe(200)
  })
})

describe('the access rules of a band (_security)', () => {
  it('are read back as CouchDB gives them - admins and members only, no internal id or revision', async () => {
    await foundBand()
    const rules = { admins: { names: [], roles: ['admin'] }, members: { names: [], roles: ['member', 'admin'] } }
    expect((await call('/stageboard-band/_security', { method: 'PUT', headers: admin, body: JSON.stringify(rules) })).status).toBe(200)
    expect(await (await call('/stageboard-band/_security', { headers: admin })).json()).toEqual(rules)
  })

  it('can be put back from what was read - a backup restores them (a stray _id or _rev in the body changes nothing)', async () => {
    await foundBand()
    const read = await (await call('/stageboard-band/_security', { headers: admin })).json()
    await call('/stageboard-band/_security', { method: 'DELETE', headers: admin }).catch(() => undefined)
    const answer = await call('/stageboard-band/_security', { method: 'PUT', headers: admin, body: JSON.stringify({ ...read, _id: '_local/_security', _rev: '0-1' }) })
    expect(answer.status).toBe(200)
    expect(await (await call('/stageboard-band/_security', { headers: admin })).json()).toEqual(read)
  })
})
