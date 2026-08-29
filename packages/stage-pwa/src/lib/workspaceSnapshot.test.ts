import { beforeEach, describe, expect, it, vi } from 'vitest'

// A tiny in-memory stand-in for pouchdb-browser, keyed by db name, so buildWorkspaceSnapshot/
// restoreWorkspaceSnapshot can be exercised without a real IndexedDB (unavailable under
// happy-dom) or a real CouchDB. One store per *workspace* now, not per collection - every
// kind shares one physical database (see workspaceDb.ts, #49 follow-up), discriminated by an
// `${kind}:` prefix on each doc's `_id` - so this fake's `allDocs` needs to honor
// startkey/endkey range filtering the same way real CouchDB does, or two kinds in the same
// store would bleed into each other.
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

    async allDocs(options: { startkey?: string; endkey?: string } = {}) {
      let docs = [...this.store.values()]
      if (options.startkey !== undefined) docs = docs.filter((doc) => doc._id >= options.startkey!)
      if (options.endkey !== undefined) docs = docs.filter((doc) => doc._id <= options.endkey!)
      const rows = docs.map((doc) => ({ id: doc._id, key: doc._id, value: { rev: doc._rev }, doc }))
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
    storeFor('stageboard-band-a').set('songs:song-1', {
      _id: 'songs:song-1',
      _rev: '1-abc',
      id: 'song-1',
      title: 'Wie ein schützender Engel',
    })

    const snapshot = await buildWorkspaceSnapshot('band-a')
    expect(snapshot.collections.songs).toHaveLength(1)

    await restoreWorkspaceSnapshot(snapshot, 'band-b')

    const restored = storeFor('stageboard-band-b').get('songs:song-1')
    expect(restored).toMatchObject({ id: 'song-1', title: 'Wie ein schützender Engel' })
  })

  it('re-stamps the current local revision instead of carrying over the exported one', async () => {
    storeFor('stageboard-band-a').set('songs:song-1', {
      _id: 'songs:song-1',
      _rev: '1-abc',
      id: 'song-1',
      title: 'Original',
    })
    const snapshot = await buildWorkspaceSnapshot('band-a')

    // The target already has its own, unrelated revision history for the same doc id.
    storeFor('stageboard-band-b').set('songs:song-1', {
      _id: 'songs:song-1',
      _rev: '7-local',
      id: 'song-1',
      title: 'Edited locally',
    })

    await restoreWorkspaceSnapshot(snapshot, 'band-b')

    const restored = storeFor('stageboard-band-b').get('songs:song-1')
    expect(restored?.title).toBe('Original')
    expect(restored?._rev.startsWith('8-')).toBe(true)
  })

  it('keeps two different kinds sharing one database from bleeding into each other', async () => {
    storeFor('stageboard-band-a').set('songs:song-1', {
      _id: 'songs:song-1',
      _rev: '1-abc',
      id: 'song-1',
      title: 'A Song',
    })
    storeFor('stageboard-band-a').set('setlists:setlist-1', {
      _id: 'setlists:setlist-1',
      _rev: '1-abc',
      id: 'setlist-1',
      name: 'A Setlist',
      entries: [],
      createdAt: 0,
    })

    const snapshot = await buildWorkspaceSnapshot('band-a')

    expect(snapshot.collections.songs).toHaveLength(1)
    expect(snapshot.collections.setlists).toHaveLength(1)
    expect(snapshot.collections.songs?.[0].id).toBe('song-1')
    expect(snapshot.collections.setlists?.[0].id).toBe('setlist-1')
  })

  it('restores correctly even from a backup exported before per-kind id prefixing existed', async () => {
    // Simulates an old-format export: `_id` was the bare application id, no `${kind}:` prefix.
    const snapshot = {
      version: 1,
      workspaceId: 'band-a',
      exportedAt: 'x',
      collections: {
        songs: [{ _id: 'song-1', _rev: '1-abc', id: 'song-1', title: 'Old Format' }],
      },
    }

    await restoreWorkspaceSnapshot(snapshot, 'band-b')

    const restored = storeFor('stageboard-band-b').get('songs:song-1')
    expect(restored).toMatchObject({ id: 'song-1', title: 'Old Format' })
  })
})
