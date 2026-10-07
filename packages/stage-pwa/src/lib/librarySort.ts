import { isSongEntry, type PracticeLogEntry, type Setlist, type Song } from 'shared-types'

/** How the Bibliothek orders its lists (Marco, 2026-10-07) - chosen per tab, remembered per device. */
export type SetlistSort = 'name' | 'newest' | 'performance'
export type SongSort = 'title' | 'artist' | 'setlist' | 'practiced' | 'practiced30'

/** Labels: [not chosen, chosen, chosen and reversed] - only the chosen option shows its
 * direction (tapping it again reverses), so the bar stays short enough for a phone. */
export const SETLIST_SORT_LABEL: Record<SetlistSort, readonly [string, string, string]> = {
  name: ['A–Z', 'A–Z', 'Z–A'],
  newest: ['Neueste', 'Neueste', 'Älteste'],
  performance: ['Auftritt', 'Auftritt ↓', 'Auftritt ↑'],
}
export const SONG_SORT_LABEL: Record<SongSort, readonly [string, string, string]> = {
  title: ['A–Z', 'A–Z', 'Z–A'],
  artist: ['Interpret', 'Interpret ↓', 'Interpret ↑'],
  setlist: ['Setlist', 'Setlist ↓', 'Setlist ↑'],
  practiced: ['Geübt', 'Geübt ↓', 'Geübt ↑'],
  practiced30: ['30 Tage', '30 Tage ↓', '30 Tage ↑'],
}

/** Which label to show: 0 not chosen, 1 chosen, 2 chosen and reversed. */
export function sortLabelIndex(chosen: boolean, reversed: boolean): 0 | 1 | 2 {
  return !chosen ? 0 : reversed ? 2 : 1
}

/** Window of the "30 Tage" option. */
export const PRACTICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const byName = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' })

/**
 * `performance`: coming gigs first, the next one on top; then past gigs, the latest on top; then
 * setlists without a date, by name. `today` is "YYYY-MM-DD" - comparing these strings sorts by
 * date.
 */
export function sortSetlists(setlists: readonly Setlist[], sort: SetlistSort, today: string): Setlist[] {
  const list = [...setlists]
  if (sort === 'name') return list.sort((a, b) => byName(a.name, b.name))
  if (sort === 'newest') return list.sort((a, b) => b.createdAt - a.createdAt)
  const rank = (s: Setlist) => (!s.performanceDate ? 2 : s.performanceDate >= today ? 0 : 1)
  return list.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 0) return a.performanceDate!.localeCompare(b.performanceDate!)
    if (ra === 1) return b.performanceDate!.localeCompare(a.performanceDate!)
    return byName(a.name, b.name)
  })
}

/** Per song, for one person: when they last practised it and how often in the last 30 days (Solo Üben). */
export function practiceStats(entries: readonly PracticeLogEntry[], profileId: string | null, now: number): Map<string, { last: number; recent: number }> {
  const stats = new Map<string, { last: number; recent: number }>()
  if (!profileId) return stats
  for (const entry of entries) {
    if (entry.profileId !== profileId) continue
    const current = stats.get(entry.songId) ?? { last: 0, recent: 0 }
    stats.set(entry.songId, { last: Math.max(current.last, entry.at), recent: current.recent + (now - entry.at <= PRACTICE_WINDOW_MS ? 1 : 0) })
  }
  return stats
}

/**
 * `setlist`: the active setlist's songs in its order on top (first appearance counts), then the
 * rest by title. `practiced`: last practised first; `practiced30`: most practised in 30 days
 * first - never practised at the end, by title (reversed: they come first - "what needs practice").
 */
export function sortSongs(songs: readonly Song[], sort: SongSort, context: { activeSetlist: Setlist | null; stats: Map<string, { last: number; recent: number }> }): Song[] {
  const list = [...songs]
  const byTitle = (a: Song, b: Song) => byName(a.title, b.title)
  if (sort === 'title') return list.sort(byTitle)
  if (sort === 'artist') return list.sort((a, b) => byName(a.artist ?? '￿', b.artist ?? '￿') || byTitle(a, b))
  if (sort === 'setlist') {
    const position = new Map<string, number>()
    for (const entry of context.activeSetlist?.entries ?? []) if (isSongEntry(entry) && !position.has(entry.songId)) position.set(entry.songId, position.size)
    return list.sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity) || byTitle(a, b))
  }
  const key = (song: Song) => {
    const stat = context.stats.get(song.id)
    return sort === 'practiced' ? (stat?.last ?? -1) : (stat?.recent ?? -1)
  }
  return list.sort((a, b) => key(b) - key(a) || byTitle(a, b))
}

/** The chosen order, or its exact reverse (tapping the chosen option again). */
export function inDirection<T>(list: T[], reversed: boolean): T[] {
  return reversed ? [...list].reverse() : list
}
