import { describe, expect, it } from 'vitest'
import type { Setlist, ShowLogEvent, Song } from 'shared-types'
import { playStats, sortSetlists, sortSongs } from './librarySort'

const setlist = (id: string, name: string, extra: Partial<Setlist> = {}): Setlist => ({ id, name, entries: [], createdAt: 0, ...extra })
const song = (id: string, title: string, artist?: string) => ({ id, title, artist, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }) as Song
const played = (songId: string, at: number): ShowLogEvent => ({ id: `${songId}-${at}`, showId: 's', type: 'song-played', at, endedAt: at + 1, songId, songTitle: songId, activeMs: 1 }) as ShowLogEvent

describe('Bibliothek sorting', () => {
  it('setlists by performance date: next gig first, then past (latest first), then undated by name', () => {
    const list = [
      setlist('past-old', 'Alt', { performanceDate: '2026-05-01' }),
      setlist('none-b', 'B ohne'),
      setlist('next2', 'Später', { performanceDate: '2026-12-24' }),
      setlist('past-new', 'Neulich', { performanceDate: '2026-09-30' }),
      setlist('next1', 'Bald', { performanceDate: '2026-10-07' }),
      setlist('none-a', 'A ohne'),
    ]
    expect(sortSetlists(list, 'performance', '2026-10-07').map((s) => s.id)).toEqual(['next1', 'next2', 'past-new', 'past-old', 'none-a', 'none-b'])
  })

  it('setlists A-Z ignores case; newest by creation', () => {
    const list = [setlist('b', 'beta', { createdAt: 1 }), setlist('a', 'Alpha', { createdAt: 2 })]
    expect(sortSetlists(list, 'name', '2026-10-07').map((s) => s.id)).toEqual(['a', 'b'])
    expect(sortSetlists(list, 'newest', '2026-10-07').map((s) => s.id)).toEqual(['a', 'b'])
  })

  const songs = [song('a', 'Alpha', 'Zappa'), song('b', 'Bravo'), song('c', 'Charlie', 'Abba')]

  it('songs by artist (no artist last), by setlist order, rest by title', () => {
    expect(sortSongs(songs, 'artist', { activeSetlist: null, stats: new Map() }).map((s) => s.id)).toEqual(['c', 'a', 'b'])
    const gig = setlist('g', 'Gig', { entries: [{ id: '1', songId: 'c', variantId: null, trackId: null }, { id: '2', songId: 'a', variantId: null, trackId: null }, { id: '3', songId: 'c', variantId: null, trackId: null }] })
    expect(sortSongs(songs, 'setlist', { activeSetlist: gig, stats: new Map() }).map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('last / most played from the show log, never-played at the end', () => {
    const stats = playStats([played('a', 100), played('b', 300), played('a', 200), played('a', 50)])
    expect(stats.get('a')).toEqual({ last: 200, count: 3 })
    expect(sortSongs(songs, 'lastPlayed', { activeSetlist: null, stats }).map((s) => s.id)).toEqual(['b', 'a', 'c'])
    expect(sortSongs(songs, 'mostPlayed', { activeSetlist: null, stats }).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })
})
