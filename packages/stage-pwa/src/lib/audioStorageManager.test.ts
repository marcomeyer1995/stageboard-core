import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Setlist, SetlistEntry, SongVariant, TrackMeta } from 'shared-types'
import { fetchTrack } from './audioClient'
import { getAudioStorageBackend } from './audioStorageBackend'
import {
  __getReconcileInFlightForTests,
  __resetReconcileSchedulerForTests,
  computeTargetKeys,
  getCatalogSizeBytes,
  isFullSyncSafe,
  reconcileAudioCache,
  scheduleReconcileAudioCache,
  SAFE_QUOTA_FRACTION,
} from './audioStorageManager'

vi.mock('./audioClient', () => ({ fetchTrack: vi.fn() }))
vi.mock('./audioStorageBackend', () => ({
  getAudioStorageBackend: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), listKeys: vi.fn() })),
}))

function track(id: string, overrides: Partial<TrackMeta> = {}): TrackMeta {
  return {
    id,
    kind: 'band-mix',
    label: id,
    source: 'upload',
    parentTrackId: null,
    mimeType: 'audio/mpeg',
    addedAt: 0,
    ...overrides,
  }
}

function variant(overrides: Partial<SongVariant> & Pick<SongVariant, 'id' | 'songId'>): SongVariant {
  return {
    label: 'Original',
    isDefault: true,
    bpm: 120,
    timeSignature: '4/4',
    clickTrackEnabled: false,
    chordProContent: '',
    timecodes: [],
    tracks: [],
    cues: [],
    beatAnchors: [],
    tempoMarkers: [],
    countInEnabled: false,
    countInBars: 1,
    ...overrides,
  }
}

function entry(id: string, songId: string, variantId: string | null = null, trackId: string | null = null): SetlistEntry {
  return { id, songId, variantId, trackId }
}

function setlist(id: string, entries: SetlistEntry[]): Setlist {
  return { id, name: 'Gig', entries, createdAt: 0 }
}

describe('getCatalogSizeBytes', () => {
  it('sums sizeBytes across every track in every variant', () => {
    const variants = [
      variant({ id: 'v1', songId: 'a', tracks: [track('t1', { sizeBytes: 100 }), track('t2', { sizeBytes: 50 })] }),
      variant({ id: 'v2', songId: 'b', tracks: [track('t3', { sizeBytes: 25 })] }),
    ]
    expect(getCatalogSizeBytes(variants)).toBe(175)
  })

  it('excludes tracks with unknown size rather than counting them as zero', () => {
    const variants = [variant({ id: 'v1', songId: 'a', tracks: [track('t1'), track('t2', { sizeBytes: 10 })] })]
    expect(getCatalogSizeBytes(variants)).toBe(10)
  })
})

describe('isFullSyncSafe', () => {
  it('allows anything when no estimate is available', () => {
    expect(isFullSyncSafe(Number.MAX_SAFE_INTEGER, null)).toBe(true)
  })

  it('is safe when the catalog fits within the safe fraction of quota', () => {
    const estimate = { usageBytes: 0, quotaBytes: 1000 }
    expect(isFullSyncSafe(1000 * SAFE_QUOTA_FRACTION, estimate)).toBe(true)
    expect(isFullSyncSafe(1000 * SAFE_QUOTA_FRACTION + 1, estimate)).toBe(false)
  })
})

describe('computeTargetKeys', () => {
  const trackA1 = track('a1', { sizeBytes: 10 })
  const trackB1 = track('b1', { sizeBytes: 10 })
  const variants: SongVariant[] = [
    variant({ id: 'va', songId: 'song-a', tracks: [trackA1] }),
    variant({ id: 'vb', songId: 'song-b', tracks: [trackB1] }),
  ]

  it('none mode targets nothing regardless of setlist or pins', () => {
    const active = setlist('s1', [entry('e1', 'song-a')])
    expect(computeTargetKeys('none', variants, active, ['song-b'])).toEqual(new Set())
  })

  it('full mode targets every track in the catalog', () => {
    expect(computeTargetKeys('full', variants, null, [])).toEqual(new Set(['va:a1', 'vb:b1']))
  })

  it('selective mode targets the active setlist plus pinned songs, not the rest of the catalog', () => {
    const active = setlist('s1', [entry('e1', 'song-a')])
    expect(computeTargetKeys('selective', variants, active, ['song-b'])).toEqual(
      new Set(['va:a1', 'vb:b1']),
    )
  })

  it('selective mode with no active setlist and no pins targets nothing', () => {
    expect(computeTargetKeys('selective', variants, null, [])).toEqual(new Set())
  })

  it('selective mode resolves an entry to its default variant when its own pick is not found', () => {
    const active = setlist('s1', [entry('e1', 'song-a', 'no-such-variant')])
    expect(computeTargetKeys('selective', variants, active, [])).toEqual(new Set(['va:a1']))
  })

  describe('alwaysKeepKeys (found live, 2026-09-16: a reload must never depend on a live network fetch for a song already playing)', () => {
    it('"none" mode still keeps whatever is currently playing, even though it targets nothing else', () => {
      expect(computeTargetKeys('none', variants, null, [], new Set(['va:a1']))).toEqual(new Set(['va:a1']))
    })

    it('"selective" mode keeps the currently-playing track even if it is outside the active setlist and not pinned', () => {
      const active = setlist('s1', [])
      expect(computeTargetKeys('selective', variants, active, [], new Set(['vb:b1']))).toEqual(
        new Set(['vb:b1']),
      )
    })

    it('"full" mode is unaffected - everything is already targeted', () => {
      expect(computeTargetKeys('full', variants, null, [], new Set(['va:a1']))).toEqual(
        new Set(['va:a1', 'vb:b1']),
      )
    })
  })
})

describe('reconcileAudioCache', () => {
  beforeEach(() => vi.clearAllMocks())

  const trackA1 = track('a1', { sizeBytes: 10 })
  const trackB1 = track('b1', { sizeBytes: 10 })
  const variants: SongVariant[] = [
    variant({ id: 'va', songId: 'song-a', tracks: [trackA1] }),
    variant({ id: 'vb', songId: 'song-b', tracks: [trackB1] }),
  ]

  it('never evicts the always-keep key, even in "none" mode', async () => {
    const remove = vi.fn()
    vi.mocked(getAudioStorageBackend).mockReturnValue({
      get: vi.fn(),
      set: vi.fn(),
      remove,
      listKeys: vi.fn().mockResolvedValue(['va:a1']),
    })
    vi.mocked(fetchTrack).mockResolvedValue(new Blob(['audio']))

    // "none" mode alone would target nothing (and evict the already-cached va:a1) - the
    // always-keep key overrides both.
    await reconcileAudioCache('none', variants, null, [], new Set(['va:a1']))

    expect(remove).not.toHaveBeenCalledWith('va:a1')
  })

  it('fetches the always-keep key on its own, fully resolved before any of the rest starts', async () => {
    vi.mocked(getAudioStorageBackend).mockReturnValue({
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      listKeys: vi.fn().mockResolvedValue([]), // nothing cached yet - both keys need fetching
    })
    let resolvePriorityFetch!: (blob: Blob) => void
    vi.mocked(fetchTrack).mockImplementation(async (variantId) => {
      if (variantId === 'va') return new Promise((resolve) => { resolvePriorityFetch = resolve })
      return new Blob(['audio']) // the non-priority fetch (vb:b1) resolves immediately
    })

    const reconcilePromise = reconcileAudioCache('full', variants, null, [], new Set(['va:a1']))
    await vi.waitFor(() => expect(fetchTrack).toHaveBeenCalledWith('va', 'a1'))

    // The non-priority key must not have been requested yet - it's waiting behind the priority batch.
    expect(fetchTrack).not.toHaveBeenCalledWith('vb', 'b1')

    resolvePriorityFetch(new Blob(['audio']))
    await reconcilePromise

    expect(fetchTrack).toHaveBeenCalledWith('vb', 'b1')
  })
})

describe('scheduleReconcileAudioCache (found live, 2026-09-16: useAudioSyncReconciler.ts re-firing many times in quick succession during PouchDB startup sync raced several full reconciliations against each other, each redundantly re-downloading the same tracks in parallel)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchTrack).mockReset()
    __resetReconcileSchedulerForTests()
  })

  const trackA1 = track('a1')
  const trackB1 = track('b1')
  const variants: SongVariant[] = [
    variant({ id: 'va', songId: 'song-a', tracks: [trackA1] }),
    variant({ id: 'vb', songId: 'song-b', tracks: [trackB1] }),
  ]

  it('coalesces several rapid calls into a single reconciliation using the latest args, not one run per call', async () => {
    const listKeys = vi.fn().mockResolvedValue([])
    vi.mocked(getAudioStorageBackend).mockReturnValue({ get: vi.fn(), set: vi.fn(), remove: vi.fn(), listKeys })
    // Only the very first fetchTrack call stays pending (so the first run's own in-flight fetch
    // can be observed before releasing it) - every later call, including the coalesced run's
    // own fetch, resolves immediately so awaiting the whole thing below can't hang.
    let resolveFirstFetch!: (blob: Blob) => void
    let firstFetchSeen = false
    vi.mocked(fetchTrack).mockImplementation(() => {
      if (!firstFetchSeen) {
        firstFetchSeen = true
        return new Promise((resolve) => { resolveFirstFetch = resolve })
      }
      return Promise.resolve(new Blob(['audio']))
    })

    // First call starts a run immediately (nothing in flight yet) - it "sees" only variant a.
    scheduleReconcileAudioCache('full', [variants[0]], null, [], new Set())
    // Two more calls land while that first run is still awaiting its fetch - neither should
    // start its own reconciliation; only the last one's args should end up mattering.
    scheduleReconcileAudioCache('full', variants, null, [], new Set())
    scheduleReconcileAudioCache('full', [variants[1]], null, [], new Set())

    await vi.waitFor(() => expect(fetchTrack).toHaveBeenCalledWith('va', 'a1'))
    expect(listKeys).toHaveBeenCalledTimes(1) // only the first run has actually started reading the cache

    resolveFirstFetch(new Blob(['audio'])) // lets the first (in-flight) run's fetch finish
    await __getReconcileInFlightForTests()

    // Exactly one queued follow-up run, using the *last* scheduled args (song-b only) - not
    // three separate reconciliations.
    expect(listKeys).toHaveBeenCalledTimes(2)
    expect(fetchTrack).toHaveBeenCalledWith('va', 'a1')
    expect(fetchTrack).toHaveBeenCalledWith('vb', 'b1')
  })

  it('runs immediately when nothing is already in flight', async () => {
    vi.mocked(getAudioStorageBackend).mockReturnValue({
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      listKeys: vi.fn().mockResolvedValue(['va:a1', 'vb:b1']),
    })

    scheduleReconcileAudioCache('full', variants, null, [], new Set())
    await __getReconcileInFlightForTests()

    expect(fetchTrack).not.toHaveBeenCalled() // both already cached, nothing to fetch
  })
})
