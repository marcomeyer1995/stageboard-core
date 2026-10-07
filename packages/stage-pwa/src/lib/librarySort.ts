import { isSongEntry, type PracticeLogEntry, type Setlist, type Song } from 'shared-types'

/** How the Bibliothek orders its lists (Marco, 2026-10-07) - chosen per tab, remembered per device. */
// Only gig date and name - creation order says nothing (Marco, 2026-10-07).
export type SetlistSort = 'performance' | 'name'
export type SongSort = 'title' | 'artist' | 'setlist' | 'practiced'

/** Labels: [not chosen, chosen, chosen and reversed] - only the chosen option shows its
 * direction (tapping it again reverses), so the bar stays short enough for a phone. */
export const SETLIST_SORT_LABEL: Record<SetlistSort, readonly [string, string, string]> = {
  performance: ['Auftritt', 'Auftritt ↓', 'Auftritt ↑'],
  name: ['A–Z', 'A–Z', 'Z–A'],
}
export const SONG_SORT_LABEL: Record<SongSort, readonly [string, string, string]> = {
  title: ['A–Z', 'A–Z', 'Z–A'],
  artist: ['Interpret', 'Interpret ↓', 'Interpret ↑'],
  setlist: ['Setlist', 'Setlist ↓', 'Setlist ↑'],
  // How often practised in the last 30 days (Marco: when it was last practised doesn't matter).
  practiced: ['Geübt', 'Geübt ↓', 'Geübt ↑'],
}

/** Which label to show: 0 not chosen, 1 chosen, 2 chosen and reversed. */
export function sortLabelIndex(chosen: boolean, reversed: boolean): 0 | 1 | 2 {
  return !chosen ? 0 : reversed ? 2 : 1
}

/** Window of the "Geübt" option. */
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

/** Per song, for one person: how often they practised it in the last 30 days (Solo Üben). */
export function practiceStats(entries: readonly PracticeLogEntry[], profileId: string | null, now: number): Map<string, number> {
  const stats = new Map<string, number>()
  if (!profileId) return stats
  for (const entry of entries) {
    if (entry.profileId !== profileId || now - entry.at > PRACTICE_WINDOW_MS) continue
    stats.set(entry.songId, (stats.get(entry.songId) ?? 0) + 1)
  }
  return stats
}

/**
 * `setlist`: the active setlist's songs in its order on top (first appearance counts), then the
 * rest by title. `practiced`: most practised in the last 30 days first, unpractised at the end
 * by title (reversed: they come first - "what needs practice").
 */
export function sortSongs(songs: readonly Song[], sort: SongSort, context: { activeSetlist: Setlist | null; stats: Map<string, number> }): Song[] {
  const list = [...songs]
  const byTitle = (a: Song, b: Song) => byName(a.title, b.title)
  if (sort === 'title') return list.sort(byTitle)
  if (sort === 'artist') return list.sort((a, b) => byName(a.artist ?? '￿', b.artist ?? '￿') || byTitle(a, b))
  if (sort === 'setlist') {
    const position = new Map<string, number>()
    for (const entry of context.activeSetlist?.entries ?? []) if (isSongEntry(entry) && !position.has(entry.songId)) position.set(entry.songId, position.size)
    return list.sort((a, b) => (position.get(a.id) ?? Infinity) - (position.get(b.id) ?? Infinity) || byTitle(a, b))
  }
  const count = (song: Song) => context.stats.get(song.id) ?? 0
  return list.sort((a, b) => count(b) - count(a) || byTitle(a, b))
}

/** The chosen order, or its exact reverse (tapping the chosen option again). */
export function inDirection<T>(list: T[], reversed: boolean): T[] {
  return reversed ? [...list].reverse() : list
}
