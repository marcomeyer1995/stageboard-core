import { describe, expect, it } from 'vitest'
import type { Setlist, SetlistEntry, ShowState, Song, SongVariant } from 'shared-types'
import type { TrackMeta } from 'shared-types'
import { computeQueue, resolveTrackForEntry, reorderToPlayNext } from './computeQueue'

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, chordProContent: '', timecodes: [] }
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

const songs: Song[] = [song('a', 'Song A'), song('b', 'Song B'), song('c', 'Song C')]

const emptyShowState: ShowState = {
  activeSetlistId: null,
  activeEntryId: null,
  activeEntryStartedAt: null,
  masterHolderId: null,
  masterClaimedAt: null,
  playbackStatus: 'stopped',
  playbackStartedAt: null,
  playbackAccumulatedMs: 0,
  trackOverride: null,
  deviceClaims: {},
  currentShowId: null,
  lastActivityAt: null,
}

describe('computeQueue', () => {
  it('falls back to catalog order with no active setlist', () => {
    const queue = computeQueue(songs, [], emptyShowState)
    expect(queue.orderedSongs.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(queue.currentSong?.id).toBe('a')
    expect(queue.nextSong?.id).toBe('b')
  })

  it('follows the active setlist order instead of catalog order', () => {
    const sl = setlist('sl-1', [entry('e1', 'c'), entry('e2', 'a'), entry('e3', 'b')])
    const queue = computeQueue(songs, [sl], { ...emptyShowState, activeSetlistId: 'sl-1' })
    expect(queue.orderedSongs.map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(queue.activeSetlist?.id).toBe('sl-1')
  })

  it('drops setlist entries whose song no longer exists in the catalog', () => {
    const sl = setlist('sl-1', [entry('e1', 'a'), entry('e2', 'deleted-song'), entry('e3', 'b')])
    const queue = computeQueue(songs, [sl], { ...emptyShowState, activeSetlistId: 'sl-1' })
    expect(queue.orderedSongs.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('picks current/next from activeEntryId', () => {
    const queue = computeQueue(songs, [], { ...emptyShowState, activeEntryId: 'b' })
    expect(queue.currentSong?.id).toBe('b')
    expect(queue.nextSong?.id).toBe('c')
  })

  it('has no next song after the last one', () => {
    const queue = computeQueue(songs, [], { ...emptyShowState, activeEntryId: 'c' })
    expect(queue.currentSong?.id).toBe('c')
    expect(queue.nextSong).toBeNull()
  })

  it('has no previous song before the first one', () => {
    const queue = computeQueue(songs, [], { ...emptyShowState, activeEntryId: 'a' })
    expect(queue.previousSong).toBeNull()
  })

  it('picks previous/current/next around the middle of the queue', () => {
    const queue = computeQueue(songs, [], { ...emptyShowState, activeEntryId: 'b' })
    expect(queue.previousSong?.id).toBe('a')
    expect(queue.currentSong?.id).toBe('b')
    expect(queue.nextSong?.id).toBe('c')
  })

  it('falls back to the first song when activeEntryId is unknown', () => {
    const queue = computeQueue(songs, [], { ...emptyShowState, activeEntryId: 'does-not-exist' })
    expect(queue.currentSong?.id).toBe('a')
  })

  it('advancing through two occurrences of the same song lands on the second, not back on the first', () => {
    // This is the exact scenario a bare activeSongId can't represent: both occurrences of
    // song 'a' would look identical, so advancing from the first would appear to loop.
    const sl = setlist('sl-1', [entry('e1', 'a'), entry('e2', 'b'), entry('e3', 'a')])
    const showState = { ...emptyShowState, activeSetlistId: 'sl-1' }

    const atFirst = computeQueue(songs, [sl], { ...showState, activeEntryId: 'e1' })
    expect(atFirst.currentEntry?.id).toBe('e1')
    expect(atFirst.nextEntry?.id).toBe('e2')

    const atSecond = computeQueue(songs, [sl], { ...showState, activeEntryId: 'e2' })
    expect(atSecond.nextEntry?.id).toBe('e3')

    const atThird = computeQueue(songs, [sl], { ...showState, activeEntryId: 'e3' })
    expect(atThird.currentEntry?.id).toBe('e3')
    expect(atThird.currentSong?.id).toBe('a')
    expect(atThird.nextEntry).toBeNull()
  })

  it('returns nulls for an empty catalog', () => {
    const queue = computeQueue([], [], emptyShowState)
    expect(queue.currentSong).toBeNull()
    expect(queue.nextSong).toBeNull()
  })

  it('allows the same song to appear twice as two distinct queue items', () => {
    const sl = setlist('sl-1', [entry('e1', 'a'), entry('e2', 'b'), entry('e3', 'a')])
    const queue = computeQueue(songs, [sl], { ...emptyShowState, activeSetlistId: 'sl-1' })
    expect(queue.orderedItems.map((item) => item.song.id)).toEqual(['a', 'b', 'a'])
    expect(queue.orderedItems.map((item) => item.entry.id)).toEqual(['e1', 'e2', 'e3'])
  })
})

describe('computeQueue variant resolution', () => {
  it('resolves the isDefault variant with no setlist selection', () => {
    const variants = [variant({ id: 'v-a', songId: 'a', isDefault: true })]
    const queue = computeQueue(songs, [], emptyShowState, variants)
    expect(queue.currentVariant?.id).toBe('v-a')
  })

  it('prefers the entry explicit variant selection over isDefault', () => {
    const variants = [
      variant({ id: 'v-a-default', songId: 'a', isDefault: true }),
      variant({ id: 'v-a-acoustic', songId: 'a', isDefault: false, label: 'Akustik' }),
    ]
    const sl = setlist('sl-1', [entry('e1', 'a', 'v-a-acoustic'), entry('e2', 'b'), entry('e3', 'c')])
    const queue = computeQueue(songs, [sl], { ...emptyShowState, activeSetlistId: 'sl-1' }, variants)
    expect(queue.currentVariant?.id).toBe('v-a-acoustic')
  })

  it('falls back to isDefault when the entry selection points at a variant that no longer exists', () => {
    const variants = [variant({ id: 'v-a-default', songId: 'a', isDefault: true })]
    const sl = setlist('sl-1', [entry('e1', 'a', 'deleted-variant'), entry('e2', 'b'), entry('e3', 'c')])
    const queue = computeQueue(songs, [sl], { ...emptyShowState, activeSetlistId: 'sl-1' }, variants)
    expect(queue.currentVariant?.id).toBe('v-a-default')
  })

  it('resolves nextVariant independently of currentVariant', () => {
    const variants = [
      variant({ id: 'v-a', songId: 'a', isDefault: true }),
      variant({ id: 'v-b', songId: 'b', isDefault: true }),
    ]
    const queue = computeQueue(songs, [], emptyShowState, variants)
    expect(queue.currentVariant?.id).toBe('v-a')
    expect(queue.nextVariant?.id).toBe('v-b')
  })

  it('is null when no variant exists yet for a song (pre-migration)', () => {
    const queue = computeQueue(songs, [], emptyShowState)
    expect(queue.currentVariant).toBeNull()
    expect(queue.nextVariant).toBeNull()
  })

  it('resolves two occurrences of the same song to two different variants independently', () => {
    const variants = [
      variant({ id: 'v-full', songId: 'a', isDefault: true, label: 'Original' }),
      variant({ id: 'v-short', songId: 'a', isDefault: false, label: 'Kurzfassung' }),
    ]
    const sl = setlist('sl-1', [
      entry('e1', 'a', 'v-full'),
      entry('e2', 'b'),
      entry('e3', 'a', 'v-short'),
    ])
    const queue = computeQueue(songs, [sl], { ...emptyShowState, activeSetlistId: 'sl-1' }, variants)
    expect(queue.orderedItems.map((item) => item.variant?.id ?? null)).toEqual(['v-full', null, 'v-short'])
  })
})

describe('resolveTrackForEntry', () => {
  function track(id: string, kind: TrackMeta['kind']): TrackMeta {
    return { id, kind, label: id, source: 'upload', parentTrackId: null, mimeType: 'audio/mpeg', addedAt: 0 }
  }
  const bandMix = track('t-band', 'band-mix')
  const stem = track('t-stem', 'stem')
  const withTracks = (tracks: TrackMeta[]) => variant({ id: 'v-a', songId: 'a', tracks })

  it('is null when the variant has no tracks', () => {
    expect(resolveTrackForEntry(entry('e1', 'a'), withTracks([]), null)).toBeNull()
  })

  it('prefers the band-mix track with no explicit choice anywhere', () => {
    const result = resolveTrackForEntry(entry('e1', 'a'), withTracks([stem, bandMix]), null)
    expect(result?.id).toBe('t-band')
  })

  it('falls back to the first track when there is no band-mix track', () => {
    const result = resolveTrackForEntry(entry('e1', 'a'), withTracks([stem]), null)
    expect(result?.id).toBe('t-stem')
  })

  it("uses the setlist entry's own trackId over the band-mix default", () => {
    const e = { ...entry('e1', 'a'), trackId: 't-stem' }
    const result = resolveTrackForEntry(e, withTracks([stem, bandMix]), null)
    expect(result?.id).toBe('t-stem')
  })

  it("an explicit override wins over the entry's own trackId - e.g. tonight's lineup change", () => {
    const e = { ...entry('e1', 'a'), trackId: 't-band' }
    const result = resolveTrackForEntry(e, withTracks([stem, bandMix]), 't-stem')
    expect(result?.id).toBe('t-stem')
  })

  it('falls back to the band-mix default if the override references a track that no longer exists', () => {
    const result = resolveTrackForEntry(entry('e1', 'a'), withTracks([stem, bandMix]), 'deleted-track')
    expect(result?.id).toBe('t-band')
  })
})

describe('reorderToPlayNext', () => {
  const entries = [entry('a', 'song-a'), entry('b', 'song-b'), entry('c', 'song-c'), entry('d', 'song-d')]

  it('moves a later entry to right after the current one', () => {
    expect(reorderToPlayNext(entries, 'd', 'a').map((e) => e.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves an earlier entry forward to right after the current one', () => {
    expect(reorderToPlayNext(entries, 'a', 'c').map((e) => e.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('is a no-op when the entry is already immediately next', () => {
    expect(reorderToPlayNext(entries.slice(0, 3), 'b', 'a').map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('puts the entry at the front when there is no current entry', () => {
    expect(reorderToPlayNext(entries.slice(0, 3), 'c', null).map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('puts the entry at the front when the current entry is not in the list', () => {
    expect(reorderToPlayNext(entries.slice(0, 3), 'c', 'not-in-list').map((e) => e.id)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('leaves every other entry in relative order', () => {
    const five = [...entries, entry('e', 'song-e')]
    expect(reorderToPlayNext(five, 'e', 'b').map((e) => e.id)).toEqual(['a', 'b', 'e', 'c', 'd'])
  })

  it('moving one occurrence of a duplicated song never touches the other', () => {
    const dup = [entry('e1', 'a'), entry('e2', 'b'), entry('e3', 'a')]
    expect(reorderToPlayNext(dup, 'e3', 'e1').map((e) => e.id)).toEqual(['e1', 'e3', 'e2'])
  })
})
