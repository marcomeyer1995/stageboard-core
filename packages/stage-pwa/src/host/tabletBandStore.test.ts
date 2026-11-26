import { describe, expect, it } from 'vitest'
import { createBandCatalog } from 'sync-host'
import { createTabletBandStore, type BandDatabase } from './tabletBandStore.js'

/** A PouchDB-shaped map: revisions included, 404 for a missing document. */
function fakeDb(store: Map<string, Record<string, unknown>>) {
  const rev = { n: 0 }
  const db: BandDatabase & { destroyed: boolean; destroy: () => Promise<void> } = {
    destroyed: false,
    async get(id) {
      const doc = store.get(id)
      if (!doc) throw Object.assign(new Error('missing'), { status: 404 })
      return doc
    },
    async put(doc) {
      const id = doc._id as string
      const current = store.get(id)
      if (doc._deleted) {
        store.delete(id)
        return { ok: true }
      }
      if (current && doc._rev !== current._rev) throw Object.assign(new Error('conflict'), { status: 409 })
      const saved = { ...doc, _rev: `${++rev.n}-x` }
      store.set(id, saved)
      return { ok: true, id, rev: saved._rev }
    },
    async allDocs({ startkey, endkey }) {
      return {
        rows: [...store.entries()]
          .filter(([id]) => id >= startkey && id < endkey)
          .map(([, doc]) => ({ doc })),
      }
    },
    async destroy() {
      db.destroyed = true
      store.clear()
    },
  }
  return db
}

function setup() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>()
  const handles = new Map<string, ReturnType<typeof fakeDb>>()
  const deleted = new Set<string>()
  const copies: { workspaceId: string; docs: number }[] = []
  const storeFor = (id: string) => {
    if (!stores.has(id)) stores.set(id, new Map())
    return stores.get(id)!
  }
  const open = (id: string) => {
    if (!handles.has(id)) handles.set(id, fakeDb(storeFor(id)))
    return handles.get(id)!
  }
  const store = createTabletBandStore({
    hostId: 'tablet-1',
    bandIds: async () => [...stores.keys()],
    open,
    copy: async (workspaceId, docs) => void copies.push({ workspaceId, docs: docs.length }),
    deleted: { is: (id) => deleted.has(id), mark: (id) => void deleted.add(id) },
  })
  /** The browser closed the connection: the host opens a new handle on the same data. */
  const replaceHandle = (id: string) => void handles.set(id, fakeDb(storeFor(id)))
  return { store, stores, storeFor, deleted, copies, open, replaceHandle }
}

describe('the tablet as a host of bands (#962)', () => {
  it('founds a band with its access doc, its write rules and the founder login - and lists it', async () => {
    const { store, storeFor } = setup()
    const credentials = await store.create('band-a', 'Band A', { founderId: 'p1', deviceId: 'phone' })
    expect(credentials.username).toBe('stageboard-band-a-p1~phone')
    const docs = storeFor('band-a')
    expect(docs.get('workspace:access')).toMatchObject({ name: 'Band A', hostId: 'tablet-1' })
    expect(docs.get('_design/roster')).toMatchObject({ validate_doc_update: expect.stringContaining('function') })
    expect(await store.bands()).toEqual(['band-a'])
    expect(await store.login('band-a', credentials.username, credentials.password)).toMatchObject({ roles: ['member', 'admin'] })
  })

  it("brings a band's old write rules up to this version, keeping the rest of the design doc (#16, #964)", async () => {
    const { store, storeFor } = setup()
    storeFor('band-old').set('_design/roster', { _id: '_design/roster', _rev: '1-a', validate_doc_update: 'function () {}', views: { v: 1 } })
    expect(await store.updateRules('band-old')).toBe(true)
    expect(storeFor('band-old').get('_design/roster')).toMatchObject({ validate_doc_update: expect.stringContaining('admin'), views: { v: 1 } })
    expect(await store.updateRules('band-old')).toBe(false)
  })

  it('reads, rotates and renames the access code without losing who founded it', async () => {
    const { store, storeFor } = setup()
    await store.create('band-a', 'Band A', { founderId: 'p1', deviceId: 'phone' })
    const first = await store.ensureAccessCode('band-a', 'Band A')
    expect(first.code).toMatch(/^\d{8}$/)
    const rotated = await store.rotateAccessCode('band-a')
    expect(rotated).not.toBe(first.code)
    expect(await store.accessCode('band-a')).toEqual({ code: rotated, name: 'Band A' })
    await store.rename('band-a', 'Neue Band')
    expect(await store.accessCode('band-a')).toEqual({ code: rotated, name: 'Neue Band' })
    expect(storeFor('band-a').get('workspace:access')).toMatchObject({ hostId: 'tablet-1' })
  })

  it('keeps a copy before it destroys a band, and remembers it was deleted', async () => {
    const { store, copies, deleted, open } = setup()
    await store.create('band-a', 'Band A', { founderId: 'p1', deviceId: 'phone' })
    await store.remove('band-a')
    expect(copies).toEqual([{ workspaceId: 'band-a', docs: 3 }])
    expect(open('band-a').destroyed).toBe(true)
    await store.markDeleted('band-a')
    expect(deleted.has('band-a')).toBe(true)
  })

  it('blocks and removes a device only through the Device Ledger, and never removes a used one', async () => {
    const { store, storeFor } = setup()
    await store.create('band-a', 'Band A', { founderId: 'p1', deviceId: 'phone' })
    await storeFor('band-a').set('devices:fire', { _id: 'devices:fire', _rev: '1-x', revoked: false })
    expect(await store.setDeviceRevoked('band-a', 'missing', true)).toBe('unknown')
    expect(await store.setDeviceRevoked('band-a', 'fire', true)).toBe('ok')
    expect(await store.forgetDevice('band-a', 'fire')).toBe('blocked')
    await storeFor('band-a').set('devices:fire', { _id: 'devices:fire', _rev: '2-x', revoked: false })
    await storeFor('band-a').set('logical-devices:light', { _id: 'logical-devices:light', _rev: '2-y', name: 'Licht', executionTarget: 'fire' })
    expect(await store.forgetDevice('band-a', 'fire')).toEqual({ usedBy: ['Licht'] })
    storeFor('band-a').delete('logical-devices:light')
    await storeFor('band-a').set('devices:fire', { _id: 'devices:fire', _rev: '3-x', revoked: false })
    expect(await store.forgetDevice('band-a', 'fire')).toBe('ok')
    expect(storeFor('band-a').has('devices:fire')).toBe(false)
  })

  it('works through the shared catalog: a second band needs an admin of the first, the founder can then manage it', async () => {
    const { store } = setup()
    const catalog = createBandCatalog({ store })
    const founder = await catalog.create({ workspaceId: 'band-a', founderId: 'p1', workspaceName: 'Band A', deviceId: 'phone' })
    expect(founder.status).toBe(201)
    const credentials = founder.body as { username: string; password: string }
    expect((await catalog.create({ workspaceId: 'band-b', founderId: 'p1', workspaceName: 'Band B', deviceId: 'phone' })).status).toBe(403)
    expect(
      (await catalog.create({ workspaceId: 'band-b', founderId: 'p1', workspaceName: 'Band B', deviceId: 'phone', adminUsername: credentials.username, adminPassword: credentials.password })).status,
    ).toBe(201)
    expect((await catalog.accessCode('band-a', { adminUsername: credentials.username, adminPassword: credentials.password })).status).toBe(200)
  })

  it('answers a unicode name or password as a wrong login, not as a crash (#962)', async () => {
    const { store } = setup()
    await store.create('band-u', 'U', { founderId: 'f', deviceId: 'd' })
    await expect(store.checkAdmin('band-u', 'Zoë', 'pässwörd €')).resolves.toBe(false)
    await expect(store.login('band-u', '日本語', 'x')).resolves.toBeNull()
  })

  it('builds its accounts again on a new database handle of the same band (the browser closed the connection) (#962)', async () => {
    const { store, replaceHandle } = setup()
    const first = await store.create('band-r', 'R', { founderId: 'f', deviceId: 'd' })
    replaceHandle('band-r')
    await expect(store.checkAdmin('band-r', first.username, first.password)).resolves.toBe(true)
  })
})
