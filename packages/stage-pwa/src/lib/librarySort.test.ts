import { describe, expect, it } from 'vitest'
import type { PracticeLogEntry, Setlist, Song } from 'shared-types'
import { inDirection, practiceStats, sortSetlists, sortSongs } from './librarySort'

const setlist = (id: string, name: string, extra: Partial<Setlist> = {}): Setlist => ({ id, name, entries: [], createdAt: 0, ...extra })
const song = (id: string, title: string, artist?: string) => ({ id, title, artist, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }) as Song
const practiced = (songId: string, at: number, profileId = 'me'): PracticeLogEntry => ({ id: `${songId}-${at}-${profileId}`, profileId, songId, at, activeMs: 60_000 })

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

  it('practice: how often practised in the last 30 days - only the own takes; reversed puts the least practised first', () => {
    const day = 86_400_000
    const now = 100 * day
    const stats = practiceStats([practiced('a', now - 40 * day), practiced('a', now - 2 * day), practiced('b', now - 1 * day), practiced('a', now - 3 * day), practiced('c', now, 'someone-else')], 'me', now)
    expect(stats.get('a')).toBe(2)
    expect(stats.has('c')).toBe(false)
    const most = sortSongs(songs, 'practiced', { activeSetlist: null, stats })
    expect(most.map((s) => s.id)).toEqual(['a', 'b', 'c'])
    expect(inDirection(most, true).map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })
})
