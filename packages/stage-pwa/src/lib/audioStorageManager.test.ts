import { describe, expect, it } from 'vitest'
import type { Setlist, SetlistEntry, SongVariant, TrackMeta } from 'shared-types'
import {
  computeTargetKeys,
  getCatalogSizeBytes,
  isFullSyncSafe,
  SAFE_QUOTA_FRACTION,
} from './audioStorageManager'

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
    chordProContent: '',
    timecodes: [],
    tracks: [],
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
})
