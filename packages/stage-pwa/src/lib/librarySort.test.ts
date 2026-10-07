import { describe, expect, it } from 'vitest'
import type { PracticeLogEntry, Setlist, ShowLogEvent, Song } from 'shared-types'
import { practiceStats, rehearsalStats, sortLabel, sortSetlists, sortSongs } from './librarySort'

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
    expect(sortSongs(songs, 'artist', { activeSetlist: null, practice: new Map(), rehearsal: new Map() }).map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(sortSongs(songs, 'artist', { activeSetlist: null, practice: new Map(), rehearsal: new Map() }, true).map((s) => s.id)).toEqual(['a', 'c', 'b'])
    const gig = setlist('g', 'Gig', { entries: [{ id: '1', songId: 'c', variantId: null, trackId: null }, { id: '2', songId: 'a', variantId: null, trackId: null }, { id: '3', songId: 'c', variantId: null, trackId: null }] })
    expect(sortSongs(songs, 'setlist', { activeSetlist: gig, practice: new Map(), rehearsal: new Map() }).map((s) => s.id)).toEqual(['c', 'a', 'b'])
  })

  const day = 86_400_000
  const now = 100 * day

  it('Geübt: own takes in the device period, plus the latest one (also outside the period); ↑ the least practised first', () => {
    const practice = practiceStats([practiced('a', now - 40 * day), practiced('a', now - 2 * day), practiced('b', now - 1 * day), practiced('a', now - 3 * day), practiced('c', now, 'someone-else')], 'me', now, 30)
    expect(practice.get('a')).toEqual({ count: 2, last: now - 2 * day })
    expect(practice.has('c')).toBe(false)
    expect(practiceStats([practiced('a', now - 40 * day)], 'me', now, 30).get('a')).toEqual({ count: 0, last: now - 40 * day })
    const context = { activeSetlist: null, practice, rehearsal: new Map() }
    expect(sortSongs(songs, 'practiced', context).map((s) => s.id)).toEqual(['c', 'b', 'a'])
    expect(sortSongs(songs, 'practiced', context, true).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('Geprobt: the band\'s Gig-mode plays in the last N days, or in the last N shows', () => {
    const played = (songId: string, showId: string, at: number): ShowLogEvent => ({ id: `${songId}-${at}`, showId, type: 'song-played', at, endedAt: at + 1, songId, songTitle: songId, activeMs: 60_000 })
    const events: ShowLogEvent[] = [
      played('a', 'show-old', now - 200 * day),
      played('a', 'show-1', now - 60 * day),
      played('b', 'show-2', now - 20 * day),
      played('a', 'show-3', now - 5 * day),
      played('b', 'show-3', now - 5 * day + 1),
    ]
    const byDays = rehearsalStats(events, { kind: 'days', days: 90 }, now)
    expect(byDays.get('a')).toEqual({ count: 2, last: now - 5 * day })
    expect(byDays.get('b')?.count).toBe(2)
    const lastTwoShows = rehearsalStats(events, { kind: 'shows', shows: 2 }, now)
    expect(lastTwoShows.get('a')?.count).toBe(1)
    expect(lastTwoShows.get('b')?.count).toBe(2)
    const context = { activeSetlist: null, practice: new Map(), rehearsal: lastTwoShows }
    expect(sortSongs(songs, 'rehearsed', context, true).map((s) => s.id)).toEqual(['b', 'a', 'c'])
  })
})
