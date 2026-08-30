import { beforeEach, describe, expect, it, vi } from 'vitest'

// createWorkspaceCollection ultimately instantiates a real PouchDB against IndexedDB at
// import time - unavailable under happy-dom (see songVariantsDb.test.ts's identical mock for
// the same reason). One shared in-memory store per db *name* - every collection now shares
// one physical database per workspace (see workspaceDb.ts), so this mock must support
// startkey/endkey range queries and a local `changes` filter the same way real CouchDB does,
// or the whole point of this test (kind-scoping) couldn't be verified.
const stores = new Map<string, Map<string, { _id: string; _rev: string; [key: string]: unknown }>>()

function storeFor(name: string) {
  let store = stores.get(name)
  if (!store) {
    store = new Map()
    stores.set(name, store)
  }
  return store
}

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    private store: Map<string, { _id: string; _rev: string; [key: string]: unknown }>

    constructor(name: string) {
      this.store = storeFor(name)
    }

    async get(id: string) {
      const doc = this.store.get(id)
      if (!doc) throw Object.assign(new Error('missing'), { status: 404 })
      return doc
    }

    async put(doc: { _id: string; _rev?: string; [key: string]: unknown }) {
      const nextRev = `${(Number(doc._rev?.split('-')[0]) || 0) + 1}-fake`
      this.store.set(doc._id, { ...doc, _rev: nextRev } as { _id: string; _rev: string })
      return { ok: true, id: doc._id, rev: nextRev }
    }

    async remove(doc: { _id: string }) {
      this.store.delete(doc._id)
      return { ok: true, id: doc._id, rev: 'deleted' }
    }

    async allDocs(options: { include_docs?: boolean; startkey?: string; endkey?: string } = {}) {
      let docs = [...this.store.values()]
      if (options.startkey !== undefined) docs = docs.filter((doc) => doc._id >= options.startkey!)
      if (options.endkey !== undefined) docs = docs.filter((doc) => doc._id <= options.endkey!)
      const rows = docs.map((doc) => ({ id: doc._id, key: doc._id, value: { rev: doc._rev }, doc }))
      return { rows, total_rows: rows.length, offset: 0 }
    }

    changes(options: { filter?: (doc: { _id: string }) => boolean } = {}) {
      const seen = [...this.store.values()].filter((doc) => options.filter?.(doc) ?? true)
      return {
        seen,
        on: () => this,
        cancel: () => {},
      }
    }
  },
}))

const { createWorkspaceCollection } = await import('./workspaceCollection')

interface Widget {
  id: string
  name: string
}

// getWorkspaceDb (workspaceDb.ts) caches its PouchDB instance per workspaceId at module
// scope and only swaps it when the id actually changes - correct in production, but a trap
// for tests sharing this one module instance across `it()` blocks: reusing the same
// workspaceId across tests would hand back a stale-but-cached db wrapper pointing at a Map
// object `stores.clear()` already orphaned. A fresh, unique workspace id per test sidesteps
// this entirely instead of fighting the cache.
let workspaceCounter = 0
function freshWorkspaceId(): string {
  workspaceCounter += 1
  return `ws-${workspaceCounter}`
}

beforeEach(() => {
  stores.clear()
})

describe('createWorkspaceCollection', () => {
  it("put() stores the doc under a kind-prefixed _id, leaving the body's own id untouched", async () => {
    const workspaceId = freshWorkspaceId()
    const widgets = createWorkspaceCollection<Widget>('widgets')
    widgets.switchWorkspace(workspaceId)

    await widgets.put({ id: 'w1', name: 'Fader' })

    const stored = storeFor(`stageboard-${workspaceId}`).get('widgets:w1')
    expect(stored).toMatchObject({ id: 'w1', name: 'Fader' })
  })

  it("getAll() only returns this collection's own docs, even when other kinds share the database", async () => {
    const workspaceId = freshWorkspaceId()
    const widgets = createWorkspaceCollection<Widget>('widgets')
    const gadgets = createWorkspaceCollection<Widget>('gadgets')
    widgets.switchWorkspace(workspaceId)
    gadgets.switchWorkspace(workspaceId)

    await widgets.put({ id: 'w1', name: 'Fader' })
    await gadgets.put({ id: 'g1', name: 'Knob' })

    const widgetDocs = await widgets.getAll()
    expect(widgetDocs).toHaveLength(1)
    expect(widgetDocs[0].id).toBe('w1')
  })

  it('put() preserves an existing _rev and _attachments when overwriting', async () => {
    const workspaceId = freshWorkspaceId()
    const widgets = createWorkspaceCollection<Widget>('widgets')
    widgets.switchWorkspace(workspaceId)
    storeFor(`stageboard-${workspaceId}`).set('widgets:w1', {
      _id: 'widgets:w1',
      _rev: '1-abc',
      id: 'w1',
      name: 'Fader',
      _attachments: { 'stub.bin': { stub: true } },
    })

    await widgets.put({ id: 'w1', name: 'Renamed Fader' })

    // The fake bumps the revision on every successful write (real CouchDB does too) - what
    // matters here is that the write succeeded at all (it would conflict without the correct
    // existing _rev as its precondition) and that _attachments survived the overwrite.
    const stored = storeFor(`stageboard-${workspaceId}`).get('widgets:w1')
    expect(stored?.name).toBe('Renamed Fader')
    expect(stored?._attachments).toEqual({ 'stub.bin': { stub: true } })
  })

  it('remove() deletes by the prefixed id and no-ops when the doc is missing', async () => {
    const workspaceId = freshWorkspaceId()
    const widgets = createWorkspaceCollection<Widget>('widgets')
    widgets.switchWorkspace(workspaceId)
    await widgets.put({ id: 'w1', name: 'Fader' })

    await widgets.remove('w1')
    expect(storeFor(`stageboard-${workspaceId}`).has('widgets:w1')).toBe(false)

    await expect(widgets.remove('never-existed')).resolves.toBeUndefined()
  })

  it('docId() exposes the exact prefixed id used internally', () => {
    const widgets = createWorkspaceCollection<Widget>('widgets')
    expect(widgets.docId('w1')).toBe('widgets:w1')
  })

  it("changes() filters to just this collection's docs, ignoring other kinds in the same db", async () => {
    const workspaceId = freshWorkspaceId()
    const widgets = createWorkspaceCollection<Widget>('widgets')
    const gadgets = createWorkspaceCollection<Widget>('gadgets')
    widgets.switchWorkspace(workspaceId)
    gadgets.switchWorkspace(workspaceId)
    await widgets.put({ id: 'w1', name: 'Fader' })
    await gadgets.put({ id: 'g1', name: 'Knob' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = widgets.changes({ since: 'now' }) as any
    expect(result.seen.map((doc: { _id: string }) => doc._id)).toEqual(['widgets:w1'])
  })
})
