import PouchDB from 'pouchdb-core'
import MemoryAdapter from 'pouchdb-adapter-memory'
import { beforeEach, describe, expect, it } from 'vitest'
import { createSyncHost, type SyncResponse } from './index.js'
import { createWriteGuard, type UserCtx } from './writeGuard.js'

PouchDB.plugin(MemoryAdapter)

// The band's rules as the Stage-Server writes them (core-backend's ROSTER_VALIDATOR_SOURCE, shortened).
const VALIDATOR = `function(newDoc, oldDoc, userCtx) {
  var isAdmin = userCtx.roles.indexOf('admin') !== -1 || userCtx.roles.indexOf('_admin') !== -1;
  if (newDoc._id === 'host-accounts' && userCtx.roles.indexOf('_admin') === -1) throw({forbidden: 'Only the Stage-Server writes the host accounts.'});
  if (newDoc._id.indexOf('profiles:') === 0 && !isAdmin) throw({forbidden: 'Only a band admin may edit the roster.'});
}`

let n = 0
let store: PouchDB.Database
let host: (ctx: UserCtx, method: string, path: string, body?: unknown, query?: Record<string, string>) => Promise<SyncResponse>
const member: UserCtx = { name: 'band-p~fire', roles: ['member'] }
const admin: UserCtx = { name: 'band-p~redmi', roles: ['member', 'admin'] }

beforeEach(async () => {
  store = new PouchDB(`guard-${++n}`, { adapter: 'memory' })
  await store.put({ _id: '_design/roster', validate_doc_update: VALIDATOR })
  await store.put({ _id: 'profiles:1', name: 'Marco' })
  const sync = createSyncHost({ open: (name) => (name === 'band' ? store : null) })
  const guard = createWriteGuard({ open: (name) => (name === 'band' ? store : null), security: async () => ({ admins: { roles: ['admin'] }, members: { roles: ['member', 'admin'] } }) })
  host = (ctx, method, path, body, query = {}) => guard(ctx, { method, path, body, query }, sync)
})

describe('write guard: the band rules on any host (docs/25)', () => {
  it('replication: a member\'s roster change is refused, the rest of the batch is written', async () => {
    const roster = await store.get('profiles:1')
    const res = await host(member, 'POST', '/band/_bulk_docs', { docs: [{ ...roster, name: 'Drummer' }, { _id: 'songs:1', title: 'TNT' }] })
    expect(res.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'profiles:1', error: 'forbidden' }), expect.objectContaining({ id: 'songs:1', ok: true })]))
    expect((await store.get('profiles:1')) as unknown).toMatchObject({ name: 'Marco' })
  })

  it('an admin may edit the roster; nobody but the Stage-Server writes host-accounts', async () => {
    const roster = await store.get('profiles:1')
    expect((await host(admin, 'PUT', '/band/profiles:1', { ...roster, name: 'Marco M.' })).status).toBe(201)
    expect((await host(admin, 'PUT', '/band/host-accounts', { accounts: [] })).status).toBe(403)
    expect((await host({ name: 'admin', roles: ['_admin'] }, 'PUT', '/band/host-accounts', { accounts: [] })).status).toBe(201)
  })

  it('a deletion and an attachment go through the rules too', async () => {
    const roster = await store.get('profiles:1')
    expect((await host(member, 'DELETE', '/band/profiles:1', undefined, { rev: roster._rev })).status).toBe(403)
    const att = { data: new Uint8Array([1, 2, 3]), contentType: 'image/png' }
    expect((await host(member, 'PUT', '/band/profiles:1/photo.png', att, { rev: roster._rev })).status).toBe(403)
    expect(await store.get('profiles:1')).toBeTruthy()
  })

  it('a member cannot replace the rules themselves', async () => {
    const design = await store.get('_design/roster')
    expect((await host(member, 'PUT', '/band/_design/roster', { ...design, validate_doc_update: 'function(){}' })).status).toBe(401)
    const res = await host(member, 'POST', '/band/_bulk_docs', { docs: [{ ...design, validate_doc_update: 'function(){}' }] })
    expect(res.body).toEqual([expect.objectContaining({ id: '_design/roster', error: 'unauthorized' })])
  })
})
