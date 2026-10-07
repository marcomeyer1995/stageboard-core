import { isSongEntry, type PracticeLogEntry, type Setlist, type Song } from 'shared-types'

/** How the Bibliothek orders its lists (Marco, 2026-10-07) - chosen per tab, remembered per device. */
// Only gig date and name - creation order says nothing (Marco, 2026-10-07).
export type SetlistSort = 'performance' | 'name'
export type SongSort = 'title' | 'artist' | 'setlist' | 'practiced'

/** Option names; bar order A–Z left, Auftritt right (Marco, 2026-10-07). */
export const SETLIST_SORT_LABEL: Record<SetlistSort, string> = { name: 'A–Z', performance: 'Auftritt' }
export const SONG_SORT_LABEL: Record<SongSort, string> = {
  title: 'A–Z',
  artist: 'Interpret',
  setlist: 'Setlist',
  // How often practised in the last 30 days (Marco: when it was last practised doesn't matter).
  practiced: 'Geübt',
}

/** The chosen option shows its direction: first tap ↑ ascending, tapping again ↓ descending
 * (Marco, 2026-10-07). The others show just their name, so the bar fits a phone. */
export function sortLabel(name: string, chosen: boolean, descending: boolean): string {
  return chosen ? `${name} ${descending ? '↓' : '↑'}` : name
}

/** Window of the "Geübt" option. */
export const PRACTICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const byName = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' })

/**
 * Sorts by `key` ascending, or descending; entries without a key (undefined) always come last,
 * in either direction. Ties by name, always A–Z.
 */
function sortBy<T>(list: readonly T[], key: (item: T) => string | number | undefined, name: (item: T) => string, descending: boolean): T[] {
  return [...list].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka === undefined || kb === undefined) {
      if (ka !== kb) return ka === undefined ? 1 : -1
      return byName(name(a), name(b))
    }
    const order = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : byName(String(ka), String(kb))
    return (descending ? -order : order) || byName(name(a), name(b))
  })
}

/** `name`: A–Z (descending Z–A). `performance`: by gig date, the earliest first (descending the
 * latest first); setlists without a date at the end. */
export function sortSetlists(setlists: readonly Setlist[], sort: SetlistSort, descending = false): Setlist[] {
  const name = (s: Setlist) => s.name
  // "YYYY-MM-DD" strings compare like dates.
  return sortBy(setlists, sort === 'name' ? name : (s) => s.performanceDate, name, descending)
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
 * `artist`: songs without one at the end. `setlist`: the active setlist's songs in its order
 * (first appearance counts), the others at the end. `practiced`: how often practised in the last
 * 30 days - ascending puts the least practised (what needs practice) first.
 */
export function sortSongs(
  songs: readonly Song[],
  sort: SongSort,
  context: { activeSetlist: Setlist | null; stats: Map<string, number> },
  descending = false,
): Song[] {
  const title = (song: Song) => song.title
  if (sort === 'title') return sortBy(songs, title, title, descending)
  if (sort === 'artist') return sortBy(songs, (song) => song.artist || undefined, title, descending)
  if (sort === 'setlist') {
    const position = new Map<string, number>()
    for (const entry of context.activeSetlist?.entries ?? []) if (isSongEntry(entry) && !position.has(entry.songId)) position.set(entry.songId, position.size)
    return sortBy(songs, (song) => position.get(song.id), title, descending)
  }
  return sortBy(songs, (song) => context.stats.get(song.id) ?? 0, title, descending)
}
