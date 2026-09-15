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
      // Real CouchDB/PouchDB's actual optimistic-concurrency precondition: a put naming a
      // stale (or, for a new doc, any) _rev loses the race and rejects with a 409 - this is
      // what putWithConflictRetry (workspaceCollection.ts) exists to retry through.
      const current = this.store.get(doc._id)
      if (current && doc._rev !== current._rev) {
        throw Object.assign(new Error('Document update conflict'), { status: 409, name: 'conflict' })
      }
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
  tag?: string
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

  it('put() lands both of two near-simultaneous writes to the same doc instead of silently dropping the loser', async () => {
    const workspaceId = freshWorkspaceId()
    const widgets = createWorkspaceCollection<Widget>('widgets')
    widgets.switchWorkspace(workspaceId)
    await widgets.put({ id: 'w1', name: 'Fader' })

    // Two near-simultaneous writes to the same doc (e.g. two debounced config sliders
    // committing moments apart). queuedWrite (workspaceCollection.ts) now serializes same-
    // process writes to one document, so neither actually races the other's db.get()/db.put()
    // pair - but the point of this test predates that (Marco, 2026-09-14: without any retry
    // *or* serialization, the loser of a real revision conflict would vanish silently, fire-
    // and-forget with no .catch()). Kept as a regression test for the outcome, not the
    // mechanism: both calls must still resolve and the doc must reflect a real write.
    await Promise.all([
      widgets.put({ id: 'w1', name: 'Renamed by A' }),
      widgets.put({ id: 'w1', name: 'Renamed by B' }),
    ])

    // Serialized, so this is deterministic: whichever call was issued second lands last.
    const stored = storeFor(`stageboard-${workspaceId}`).get('widgets:w1')
    expect(stored?.name).toBe('Renamed by B')
  })

  it("update() re-applies the patch against freshly re-read data, so two concurrent field-level edits both land instead of one silently overwriting the other", async () => {
    const workspaceId = freshWorkspaceId()
    const widgets = createWorkspaceCollection<Widget>('widgets')
    widgets.switchWorkspace(workspaceId)
    await widgets.put({ id: 'w1', name: 'Fader', tag: 'A' })

    // Two edits to *different* fields of the same doc, committing moments apart (e.g. two
    // independently-debounced config sliders). A naive "read from cache, put() the whole
    // spread object" approach would let whichever commits second silently revert the
    // other's field, even with a successful (non-conflicting) write. update()'s patch is
    // re-applied against the real current document on every attempt (whether serialized by
    // queuedWrite, as these two now are, or genuinely retried after a conflict from outside
    // this process), so both edits survive regardless of which one lands last.
    await Promise.all([
      widgets.update('w1', (current) => ({ ...current, name: 'Renamed' })),
      widgets.update('w1', (current) => ({ ...current, tag: 'B' })),
    ])

    const stored = storeFor(`stageboard-${workspaceId}`).get('widgets:w1')
    expect(stored?.name).toBe('Renamed')
    expect(stored?.tag).toBe('B')
  })

  it('queues concurrent update() calls to the same document so a burst of debounced commits lands deterministically instead of racing', async () => {
    const workspaceId = freshWorkspaceId()
    const widgets = createWorkspaceCollection<Widget>('widgets')
    widgets.switchWorkspace(workspaceId)
    await widgets.put({ id: 'w1', name: 'Fader', tag: '0' })

    // Six debounced commits firing back-to-back with none of them awaiting the previous one -
    // exactly the shape that produced a live conflict storm and a value visibly jumping
    // through every intermediate commit for 30-40+ seconds before this queue existed (Marco,
    // 2026-09-14, workspaceCollection.ts's `queuedWrite`).
    await Promise.all(
      ['1', '2', '3', '4', '5', '6'].map((tag) => widgets.update('w1', (current) => ({ ...current, tag }))),
    )

    // Serialized, so the outcome is the last commit issued winning deterministically - not
    // "whichever happened to win a race" (which, pre-fix, could even be a stale earlier value
    // landing *after* a later one, since retries had no guaranteed ordering either).
    const stored = storeFor(`stageboard-${workspaceId}`).get('widgets:w1')
    expect(stored?.tag).toBe('6')
    // Exactly one successful put per commit (the initial one plus the six updates) - no
    // conflict-driven retry attempts wasted along the way, since each commit only starts its
    // own read-then-write once the previous one has actually landed.
    expect(stored?._rev).toBe('7-fake')
  })

  it('update() no-ops when the document does not exist - nothing sensible to patch', async () => {
    const workspaceId = freshWorkspaceId()
    const widgets = createWorkspaceCollection<Widget>('widgets')
    widgets.switchWorkspace(workspaceId)

    await expect(widgets.update('never-existed', (current) => ({ ...current, name: 'x' }))).resolves.toBeUndefined()
    expect(storeFor(`stageboard-${workspaceId}`).has('widgets:never-existed')).toBe(false)
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
