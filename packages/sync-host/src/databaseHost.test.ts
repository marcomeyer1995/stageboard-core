import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import PouchDB from 'pouchdb-core'
import HttpAdapter from 'pouchdb-adapter-http'
import MemoryAdapter from 'pouchdb-adapter-memory'
import Replication from 'pouchdb-replication'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBandAccounts, type AccountDoc, type AccountStore } from './host/bandAccounts.js'
import { createDatabaseHost, type Catalog, type DatabaseHostRequest } from './databaseHost.js'

PouchDB.plugin(HttpAdapter).plugin(MemoryAdapter).plugin(Replication)

// The validator the Stage-Server writes into every band (core-backend workspaceProvisioning.ts).
const ROSTER = `function(newDoc, oldDoc, userCtx) {
  var isAdmin = userCtx.roles.indexOf('admin') !== -1 || userCtx.roles.indexOf('_admin') !== -1;
  if (newDoc._id.indexOf('profiles:') === 0 && !isAdmin) {
    throw({forbidden: 'Only a band admin may edit the roster.'});
  }
  if (newDoc._id.indexOf('band-settings:') === 0 && !isAdmin) {
    throw({forbidden: 'Only a band admin may change the band settings.'});
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
  const handler = createDatabaseHost({ storage: (name) => new PouchDB(prefix + name, { adapter: 'memory' }), catalog, admin: { user: 'admin', password: 'secret' }, longpollMaxMs: 2000 })
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const raw = Buffer.concat(chunks)
    const type = req.headers['content-type'] ?? ''
    const body = raw.length === 0 ? undefined : type.includes('json') ? JSON.parse(raw.toString('utf8')) : { data: new Uint8Array(raw), contentType: type }
    const request: DatabaseHostRequest = { method: req.method ?? 'GET', path: url.pathname, query: Object.fromEntries(url.searchParams), body, authorization: req.headers.authorization }
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
const login = (u: { username: string; password: string }) => auth(u.username, u.password)

/** A band the way core-backend founds one: database, access rules, validator. */
async function foundBands(...bands: string[]) {
  for (const band of bands.length ? bands : ['band']) {
    expect((await call(`/stageboard-${band}`, { method: 'PUT', headers: admin })).status).toBe(201)
    await call(`/stageboard-${band}/_security`, { method: 'PUT', headers: admin, body: JSON.stringify({ members: { names: [], roles: ['member'] } }) })
    await call(`/stageboard-${band}/_design/roster`, { method: 'PUT', headers: admin, body: JSON.stringify({ validate_doc_update: ROSTER }) })
  }
}

describe('the database host (docs/25, #960)', () => {
  it('founding a band twice is refused, and a database that is not there is not found', async () => {
    await foundBands('band')
    expect((await call('/stageboard-band', { method: 'PUT', headers: admin })).status).toBe(412)
    expect((await call('/stageboard-nope', { headers: admin })).status).toBe(404)
  })

  it('only members sync the band: a login of another band, a wrong password and no login are turned away', async () => {
    await foundBands('band', 'other')
    const kai = await bandAccounts('band').provisionDevice('kai', 'd1', false)
    const stranger = await bandAccounts('other').provisionDevice('kai', 'd1', false)
    expect((await call('/stageboard-band', { headers: login(kai) })).status).toBe(200)
    expect((await call('/stageboard-band', { headers: login(stranger) })).status).toBe(401)
    expect((await call('/stageboard-band', { headers: auth(kai.username, 'wrong') })).status).toBe(401)
    expect((await call('/stageboard-band')).status).toBe(401)
    expect((await call('/stageboard-band/_local/_security', { method: 'PUT', headers: login(kai), body: JSON.stringify({ members: { roles: [] } }) })).status).toBe(403)
  })

  it("the band's validator holds, also for what arrives by replication: a member may not edit the roster, an admin may", async () => {
    await foundBands('band')
    const kai = await bandAccounts('band').provisionDevice('kai', 'd1', false)
    const marco = await bandAccounts('band').provisionDevice('marco', 'd2', true)
    const forbidden = await call('/stageboard-band/profiles:kai', { method: 'PUT', headers: login(kai), body: JSON.stringify({ name: 'Kai' }) })
    expect(forbidden.status).toBe(403)
    expect((await forbidden.json()).reason).toBe('Only a band admin may edit the roster.')
    expect((await call('/stageboard-band/profiles:kai', { method: 'PUT', headers: login(marco), body: JSON.stringify({ name: 'Kai' }) })).status).toBe(201)

    // A member's tablet replicates a song and a forged profile: the song lands, the profile not.
    const tablet = new PouchDB(`kai-tablet-${n}`, { adapter: 'memory' })
    await tablet.bulkDocs([{ _id: 'song:1', title: 'TNT' }, { _id: 'profiles:kai', name: 'Kai der Admin' }])
    const remote = new PouchDB(`${web.url}/stageboard-band`, { skip_setup: true, fetch: (url, opts) => PouchDB.fetch(url, { ...opts, headers: { ...Object.fromEntries(new Headers(opts?.headers)), ...login(kai) } }) })
    await tablet.replicate.to(remote)
    const band = await (await call('/stageboard-band/_all_docs?include_docs=true', { headers: admin })).json()
    const byId = Object.fromEntries(band.rows.map((r: { id: string; doc: { name?: string; title?: string } }) => [r.id, r.doc]))
    expect(byId['song:1'].title).toBe('TNT')
    expect(byId['profiles:kai'].name).toBe('Kai')
  })

  it('the band list and deleting a band are for the server admin only', async () => {
    await foundBands('band')
    const marco = await bandAccounts('band').provisionDevice('marco', 'd2', true)
    expect(await (await call('/_all_dbs', { headers: admin })).json()).toEqual(['stageboard-band'])
    expect((await call('/_all_dbs', { headers: login(marco) })).status).toBe(401)
    expect((await call('/stageboard-band', { method: 'DELETE', headers: login(marco) })).status).toBe(403)
    expect((await call('/stageboard-band', { method: 'DELETE', headers: admin })).status).toBe(200)
    expect(await (await call('/_all_dbs', { headers: admin })).json()).toEqual([])
  })
})

describe("a device's login lives in the band's own database (#960)", () => {
  it('lets a device with a login of the band into that band - and not into another band', async () => {
    await foundBands('band', 'other')
    const device = await bandAccounts('band').provisionDevice('p1', 'd1', false)
    expect((await call('/stageboard-band/_all_docs', { headers: login(device) })).status).toBe(200)
    expect((await call('/stageboard-other/_all_docs', { headers: login(device) })).status).toBe(401)
  })

  it('turns away a wrong password, a login nobody made, and one that was taken out', async () => {
    await foundBands('band')
    const accounts = bandAccounts('band')
    const device = await accounts.provisionDevice('p1', 'd1', false)
    expect((await call('/stageboard-band/_all_docs', { headers: auth(device.username, 'wrong') })).status).toBe(401)
    expect((await call('/stageboard-band/_all_docs', { headers: auth('stageboard-band-p1~ghost', device.password) })).status).toBe(401)
    await accounts.removeMember('p1')
    // a revoked login is turned away at once on a fresh host check (the remembered check lasts a few minutes)
    expect((await call('/stageboard-band/_all_docs', { headers: login(device) })).status).toBe(401)
  })

  it('does not let a plain login write the accounts themselves', async () => {
    await foundBands('band')
    const member = await bandAccounts('band').provisionDevice('p1', 'd1', false)
    const forged = await call('/stageboard-band/account:stageboard-band-p1~evil', { method: 'PUT', headers: login(member), body: JSON.stringify({ _id: 'account:stageboard-band-p1~evil', roles: ['member', 'admin'] }) })
    expect(forged.status).toBe(403)
  })

  it('lets a device the band lists as a host write the accounts with its own login - nobody else', async () => {
    await foundBands('band')
    const accounts = bandAccounts('band')
    const tablet = await accounts.provisionDevice('p1', 'tablet-1', false)
    const fire = await accounts.provisionDevice('p1', 'fire', false)
    const boss = await accounts.provisionDevice('p2', 'laptop', true)
    // The band lists the tablet as a host - written by an admin, the only one who may write the settings.
    const settings = { _id: 'band-settings:band', hosts: [{ hostId: 'tablet-1', url: 'https://10.0.0.2:8443', priority: 1 }] }
    expect((await call('/stageboard-band/band-settings:band', { method: 'PUT', headers: login(boss), body: JSON.stringify(settings) })).status).toBe(201)
    const write = (who: { username: string; password: string }, name: string) =>
      call(`/stageboard-band/account:${name}`, { method: 'PUT', headers: login(who), body: JSON.stringify({ _id: `account:${name}`, name, roles: ['member'] }) })
    expect((await write(tablet, 'stageboard-band-p3~new-device')).status).toBe(201)
    expect((await write(fire, 'stageboard-band-p3~other')).status).toBe(403)
    // An admin is not a host just by being one: the role belongs to the device.
    expect((await write(boss, 'stageboard-band-p3~third')).status).toBe(403)
  })

  it('a member cannot make itself a host by writing the settings - only a band admin may', async () => {
    await foundBands('band')
    const fire = await bandAccounts('band').provisionDevice('p1', 'fire', false)
    const settings = { _id: 'band-settings:band', hosts: [{ hostId: 'fire', url: 'https://10.0.0.9:8443', priority: 1 }] }
    expect((await call('/stageboard-band/band-settings:band', { method: 'PUT', headers: login(fire), body: JSON.stringify(settings) })).status).toBe(403)
  })

  it('there is no other account list: the old _users database does not exist', async () => {
    await foundBands('band')
    expect((await call('/_users', { headers: admin })).status).toBe(404)
    expect((await call('/_session', { headers: admin })).status).toBe(404)
  })
})

describe('the access rules of a band (_security)', () => {
  it('are read back as a database gives them - admins and members only, no internal id or revision', async () => {
    await foundBands('band')
    const rules = { admins: { names: [], roles: ['admin'] }, members: { names: [], roles: ['member', 'admin'] } }
    expect((await call('/stageboard-band/_security', { method: 'PUT', headers: admin, body: JSON.stringify(rules) })).status).toBe(200)
    expect(await (await call('/stageboard-band/_security', { headers: admin })).json()).toEqual(rules)
  })

  it('can be put back from what was read - a backup restores them (a stray _id or _rev in the body changes nothing)', async () => {
    await foundBands('band')
    const read = await (await call('/stageboard-band/_security', { headers: admin })).json()
    await call('/stageboard-band/_security', { method: 'DELETE', headers: admin }).catch(() => undefined)
    const answer = await call('/stageboard-band/_security', { method: 'PUT', headers: admin, body: JSON.stringify({ ...read, _id: '_local/_security', _rev: '0-1' }) })
    expect(answer.status).toBe(200)
    expect(await (await call('/stageboard-band/_security', { headers: admin })).json()).toEqual(read)
  })
})
