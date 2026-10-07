import { describe, expect, it } from 'vitest'
import type { PracticeLogEntry, Setlist, Song } from 'shared-types'
import { practiceStats, sortLabel, sortSetlists, sortSongs } from './librarySort'

const setlist = (id: string, name: string, extra: Partial<Setlist> = {}): Setlist => ({ id, name, entries: [], createdAt: 0, ...extra })
const song = (id: string, title: string, artist?: string) => ({ id, title, artist, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }) as Song
const practiced = (songId: string, at: number, profileId = 'me'): PracticeLogEntry => ({ id: `${songId}-${at}-${profileId}`, profileId, songId, at, activeMs: 60_000 })

describe('Bibliothek sorting', () => {
  it('setlists by gig date: ↑ the earliest first, ↓ the latest first - undated always at the end, by name', () => {
    const list = [
      setlist('may', 'Alt', { performanceDate: '2026-05-01' }),
      setlist('none-b', 'B ohne'),
      setlist('dec', 'Später', { performanceDate: '2026-12-24' }),
      setlist('sep', 'Neulich', { performanceDate: '2026-09-30' }),
      setlist('oct', 'Bald', { performanceDate: '2026-10-07' }),
      setlist('none-a', 'A ohne'),
    ]
    expect(sortSetlists(list, 'performance').map((s) => s.id)).toEqual(['may', 'sep', 'oct', 'dec', 'none-a', 'none-b'])
    expect(sortSetlists(list, 'performance', true).map((s) => s.id)).toEqual(['dec', 'oct', 'sep', 'may', 'none-a', 'none-b'])
  })

  it('setlists A-Z ignores case; ↓ is Z-A', () => {
    const list = [setlist('b', 'beta'), setlist('a', 'Alpha')]
    expect(sortSetlists(list, 'name').map((s) => s.id)).toEqual(['a', 'b'])
    expect(sortSetlists(list, 'name', true).map((s) => s.id)).toEqual(['b', 'a'])
  })

  it('the chosen option shows ↑ (ascending) first, ↓ (descending) after tapping again; the others no arrow', () => {
    expect(sortLabel('Auftritt', true, false)).toBe('Auftritt ↑')
    expect(sortLabel('Auftritt', true, true)).toBe('Auftritt ↓')
    expect(sortLabel('Auftritt', false, false)).toBe('Auftritt')
  })

  const songs = [song('a', 'Alpha', 'Zappa'), song('b', 'Bravo'), song('c', 'Charlie', 'Abba')]

  it('songs by artist (no artist last, also descending), by setlist order, rest by title', () => {
    expect(sortSongs(songs, 'artist', { activeSetlist: null, stats: new Map() }).map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(sortSongs(songs, 'artist', { activeSetlist: null, stats: new Map() }, true).map((s) => s.id)).toEqual(['a', 'c', 'b'])
    const gig = setlist('g', 'Gig', { entries: [{ id: '1', songId: 'c', variantId: null, trackId: null }, { id: '2', songId: 'a', variantId: null, trackId: null }, { id: '3', songId: 'c', variantId: null, trackId: null }] })
    expect(sortSongs(songs, 'setlist', { activeSetlist: gig, stats: new Map() }).map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  it('practice: how often practised in the last 30 days - only the own takes; ↑ the least practised first', () => {
    const day = 86_400_000
    const now = 100 * day
    const stats = practiceStats([practiced('a', now - 40 * day), practiced('a', now - 2 * day), practiced('b', now - 1 * day), practiced('a', now - 3 * day), practiced('c', now, 'someone-else')], 'me', now)
    expect(stats.get('a')).toBe(2)
    expect(stats.has('c')).toBe(false)
    expect(sortSongs(songs, 'practiced', { activeSetlist: null, stats }).map((s) => s.id)).toEqual(['c', 'b', 'a'])
    expect(sortSongs(songs, 'practiced', { activeSetlist: null, stats }, true).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })
})
