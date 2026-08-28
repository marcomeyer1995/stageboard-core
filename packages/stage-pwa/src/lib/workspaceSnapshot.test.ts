import { beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny in-memory stand-in for pouchdb-browser, keyed by db name, so buildWorkspaceSnapshot/
// restoreWorkspaceSnapshot can be exercised without a real IndexedDB (unavailable under
// happy-dom) or a real CouchDB.
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

    async allDocs() {
      const rows = [...this.store.values()].map((doc) => ({
        id: doc._id,
        key: doc._id,
        value: { rev: doc._rev },
        doc,
      }))
      return { rows, total_rows: rows.length, offset: 0 }
    }

    async bulkDocs(docs: { _id: string; _rev?: string; [key: string]: unknown }[]) {
      return docs.map((doc) => {
        const nextRev = `${(Number(doc._rev?.split('-')[0]) || 0) + 1}-fake`
        this.store.set(doc._id, { ...doc, _rev: nextRev } as { _id: string; _rev: string })
        return { ok: true, id: doc._id, rev: nextRev }
      })
    }
  },
}))

const {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshot,
  restoreWorkspaceSnapshot,
} = await import('./workspaceSnapshot')

beforeEach(() => {
  stores.clear()
})

describe('parseWorkspaceSnapshot', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseWorkspaceSnapshot('{not json')).toThrow(/JSON/)
  })

  it('rejects an unsupported version', () => {
    expect(() => parseWorkspaceSnapshot(JSON.stringify({ version: 99, collections: {} }))).toThrow(
      /Version/,
    )
  })

  it('rejects a file with no collections', () => {
    expect(() => parseWorkspaceSnapshot(JSON.stringify({ version: 1 }))).toThrow(/Daten/)
  })

  it('accepts a well-formed snapshot', () => {
    const snapshot = parseWorkspaceSnapshot(
      JSON.stringify({ version: 1, workspaceId: 'band-a', exportedAt: 'x', collections: {} }),
    )
    expect(snapshot.workspaceId).toBe('band-a')
  })
})

describe('buildWorkspaceSnapshot / restoreWorkspaceSnapshot', () => {
  it('round-trips documents through export and import', async () => {
    storeFor('stageboard-songs-band-a').set('song-1', {
      _id: 'song-1',
      _rev: '1-abc',
      id: 'song-1',
      title: 'Wie ein schützender Engel',
    })

    const snapshot = await buildWorkspaceSnapshot('band-a')
    expect(snapshot.collections.songs).toHaveLength(1)

    await restoreWorkspaceSnapshot(snapshot, 'band-b')

    const restored = storeFor('stageboard-songs-band-b').get('song-1')
    expect(restored).toMatchObject({ id: 'song-1', title: 'Wie ein schützender Engel' })
  })

  it('re-stamps the current local revision instead of carrying over the exported one', async () => {
    storeFor('stageboard-songs-band-a').set('song-1', {
      _id: 'song-1',
      _rev: '1-abc',
      id: 'song-1',
      title: 'Original',
    })
    const snapshot = await buildWorkspaceSnapshot('band-a')

    // The target already has its own, unrelated revision history for the same doc id.
    storeFor('stageboard-songs-band-b').set('song-1', {
      _id: 'song-1',
      _rev: '7-local',
      id: 'song-1',
      title: 'Edited locally',
    })

    await restoreWorkspaceSnapshot(snapshot, 'band-b')

    const restored = storeFor('stageboard-songs-band-b').get('song-1')
    expect(restored?.title).toBe('Original')
    expect(restored?._rev.startsWith('8-')).toBe(true)
  })
})
