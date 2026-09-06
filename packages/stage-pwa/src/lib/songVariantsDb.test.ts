import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song, TrackMeta } from 'shared-types'

// createWorkspaceCollection instantiates a real PouchDB against IndexedDB at import time -
// unavailable under happy-dom (see Dashboard.test.tsx's identical mock for the same reason).
// A tiny in-memory store stands in for the local 'song-variants' PouchDB.
const store = new Map<string, Record<string, unknown>>()

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    async get(id: string) {
      const doc = store.get(id)
      if (!doc) {
        throw Object.assign(new Error('missing'), { status: 404 })
      }
      return doc
    }
    async put(doc: { _id: string; [key: string]: unknown }) {
      store.set(doc._id, { ...doc, _rev: '1-fake' })
      return { ok: true, id: doc._id, rev: '1-fake' }
    }
    async allDocs() {
      return { rows: [...store.values()].map((doc) => ({ id: doc._id, doc })) }
    }
    async remove(doc: { _id: string }) {
      store.delete(doc._id)
      return { ok: true, id: doc._id, rev: 'deleted' }
    }
    changes() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const audioClientMocks = vi.hoisted(() => ({
  uploadTrack: vi.fn(),
  fetchTrack: vi.fn(),
  deleteTrackFile: vi.fn(),
}))
vi.mock('./audioClient', () => audioClientMocks)

const cacheStore = new Map<string, Blob>()
vi.mock('./audioCache', () => ({
  cacheKey: (variantId: string, trackId: string) => `${variantId}:${trackId}`,
  getCached: async (key: string) => cacheStore.get(key) ?? null,
  setCached: async (key: string, blob: Blob) => {
    cacheStore.set(key, blob)
  },
  removeCached: async (key: string) => {
    cacheStore.delete(key)
  },
  listCachedKeys: async () => [...cacheStore.keys()],
}))

const { getVariantsDb, putTrack, getTrack, removeTrack, ensureDefaultVariant, removeSongAndVariants } = await import(
  './songVariantsDb'
)

function makeTrackMeta(overrides: Partial<TrackMeta> = {}): TrackMeta {
  return {
    id: 'track-1',
    kind: 'band-mix',
    label: 'Backing-Track',
    source: 'upload',
    parentTrackId: null,
    mimeType: 'audio/mpeg',
    addedAt: 0,
    ...overrides,
  }
}

describe('songVariantsDb track storage', () => {
  beforeEach(() => {
    store.clear()
    cacheStore.clear()
    vi.clearAllMocks()
    // 'song-variants:' prefix - collections now share one physical database, discriminated
    // by id prefix (see workspaceCollection.ts, #49 follow-up).
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', id: 'variant-1', tracks: [] })
  })

  it('putTrack uploads to the server, caches locally, and records track metadata', async () => {
    audioClientMocks.uploadTrack.mockResolvedValue({ status: 'ok' })
    const file = new Blob(['bytes'], { type: 'audio/mpeg' })
    const meta = makeTrackMeta()

    await putTrack('variant-1', meta, file)

    expect(audioClientMocks.uploadTrack).toHaveBeenCalledWith('variant-1', 'track-1', file)
    expect(cacheStore.get('variant-1:track-1')).toBe(file)
    const db = getVariantsDb()
    const doc = (await db.get('song-variants:variant-1')) as { tracks: TrackMeta[] }
    expect(doc.tracks).toEqual([{ ...meta, sizeBytes: file.size }])
  })

  it('putTrack throws and does not record metadata when the upload fails', async () => {
    audioClientMocks.uploadTrack.mockResolvedValue({ status: 'error', message: 'HTTP 500' })
    const file = new Blob(['bytes'], { type: 'audio/mpeg' })

    await expect(putTrack('variant-1', makeTrackMeta(), file)).rejects.toThrow('HTTP 500')

    const db = getVariantsDb()
    const doc = (await db.get('song-variants:variant-1')) as { tracks: TrackMeta[] }
    expect(doc.tracks).toEqual([])
    expect(cacheStore.size).toBe(0)
  })

  it('getTrack returns the cached blob without hitting the network', async () => {
    const cached = new Blob(['cached'])
    cacheStore.set('variant-1:track-1', cached)

    const result = await getTrack('variant-1', 'track-1')

    expect(result).toBe(cached)
    expect(audioClientMocks.fetchTrack).not.toHaveBeenCalled()
  })

  it('getTrack falls back to fetching from the server and caches the result on a cache miss', async () => {
    const fetched = new Blob(['fetched'])
    audioClientMocks.fetchTrack.mockResolvedValue(fetched)

    const result = await getTrack('variant-1', 'track-1')

    expect(result).toBe(fetched)
    expect(cacheStore.get('variant-1:track-1')).toBe(fetched)
  })

  it('getTrack returns null when neither cached nor fetchable', async () => {
    audioClientMocks.fetchTrack.mockResolvedValue(null)
    expect(await getTrack('variant-1', 'missing')).toBeNull()
  })

  it('removeTrack deletes server-side and cached copies and drops the metadata entry', async () => {
    const meta = makeTrackMeta()
    store.set('song-variants:variant-1', { _id: 'song-variants:variant-1', id: 'variant-1', tracks: [meta] })
    cacheStore.set('variant-1:track-1', new Blob(['bytes']))

    await removeTrack('variant-1', 'track-1')

    expect(audioClientMocks.deleteTrackFile).toHaveBeenCalledWith('variant-1', 'track-1')
    expect(cacheStore.has('variant-1:track-1')).toBe(false)
    const db = getVariantsDb()
    const doc = (await db.get('song-variants:variant-1')) as { tracks: TrackMeta[] }
    expect(doc.tracks).toEqual([])
  })
})

function makeSong(overrides: Partial<Song> = {}): Song {
  return { id: 'song-1', title: 'Test Song', bpm: 120, chordProContent: '', timecodes: [], ...overrides }
}

describe('ensureDefaultVariant', () => {
  beforeEach(() => {
    store.clear()
  })

  it('#99: normalizes a pre-existing default variant written before `cues` existed, instead of returning it with cues undefined', async () => {
    // No `cues` key at all - exactly what a raw PouchDB doc predating #99 looks like (the read
    // path useSongVariantsStore's toVariant already defends against, but ensureDefaultVariant
    // reads getAllVariants() directly and bypassed that - found live, crashed CueListEditor).
    store.set('song-variants:variant-1', {
      _id: 'song-variants:variant-1',
      id: 'variant-1',
      songId: 'song-1',
      label: 'Original',
      isDefault: true,
      bpm: 120,
      chordProContent: '',
      timecodes: [],
      tracks: [],
    })

    const variant = await ensureDefaultVariant(makeSong())

    expect(variant.id).toBe('variant-1')
    expect(variant.cues).toEqual([])
  })

  it('leaves an existing default variant\'s real cues untouched', async () => {
    const cue = { id: 'cue-1', timeMs: 1000, targetLogicalDeviceId: 'ld-1', type: 'rig_change' }
    store.set('song-variants:variant-1', {
      _id: 'song-variants:variant-1',
      id: 'variant-1',
      songId: 'song-1',
      label: 'Original',
      isDefault: true,
      bpm: 120,
      chordProContent: '',
      timecodes: [],
      tracks: [],
      cues: [cue],
    })

    const variant = await ensureDefaultVariant(makeSong())

    expect(variant.cues).toEqual([cue])
  })
})

describe('removeSongAndVariants (#105)', () => {
  beforeEach(() => {
    store.clear()
    cacheStore.clear()
    vi.clearAllMocks()
  })

  it('deletes the song, every one of its variants, and their tracks - leaving other songs untouched', async () => {
    store.set('songs:song-1', { _id: 'songs:song-1', id: 'song-1', title: 'Delete Me' })
    store.set('song-variants:variant-1', {
      _id: 'song-variants:variant-1',
      id: 'variant-1',
      songId: 'song-1',
      tracks: [makeTrackMeta({ id: 'track-1' })],
    })
    store.set('song-variants:variant-2', {
      _id: 'song-variants:variant-2',
      id: 'variant-2',
      songId: 'song-1',
      tracks: [],
    })
    cacheStore.set('variant-1:track-1', new Blob(['bytes']))
    // A second song's own data must survive untouched.
    store.set('songs:song-2', { _id: 'songs:song-2', id: 'song-2', title: 'Keep Me' })
    store.set('song-variants:variant-3', {
      _id: 'song-variants:variant-3',
      id: 'variant-3',
      songId: 'song-2',
      tracks: [],
    })

    await removeSongAndVariants('song-1')

    expect(audioClientMocks.deleteTrackFile).toHaveBeenCalledWith('variant-1', 'track-1')
    expect(cacheStore.has('variant-1:track-1')).toBe(false)
    expect(store.has('songs:song-1')).toBe(false)
    expect(store.has('song-variants:variant-1')).toBe(false)
    expect(store.has('song-variants:variant-2')).toBe(false)
    expect(store.has('songs:song-2')).toBe(true)
    expect(store.has('song-variants:variant-3')).toBe(true)
  })

  it('deletes a song with no variants at all without throwing', async () => {
    store.set('songs:song-1', { _id: 'songs:song-1', id: 'song-1', title: 'No Variants Yet' })

    await expect(removeSongAndVariants('song-1')).resolves.toBeUndefined()
    expect(store.has('songs:song-1')).toBe(false)
  })
})
