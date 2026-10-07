import { isSongEntry, type Setlist, type ShowLogEvent, type Song } from 'shared-types'

/** How the Bibliothek orders its lists (Marco, 2026-10-07) - chosen per tab, remembered per device. */
export type SetlistSort = 'name' | 'newest' | 'performance'
export type SongSort = 'title' | 'artist' | 'setlist' | 'lastPlayed' | 'mostPlayed'

export const SETLIST_SORT_LABEL: Record<SetlistSort, string> = { name: 'A–Z', newest: 'Neueste', performance: 'Auftritt' }
export const SONG_SORT_LABEL: Record<SongSort, string> = { title: 'A–Z', artist: 'Interpret', setlist: 'Setlist', lastPlayed: 'Zuletzt', mostPlayed: 'Häufig' }

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

/** Per song: when it was last played and how often, from the show log's "song-played" events. */
export function playStats(events: readonly ShowLogEvent[]): Map<string, { last: number; count: number }> {
  const stats = new Map<string, { last: number; count: number }>()
  for (const event of events) {
    if (event.type !== 'song-played') continue
    const current = stats.get(event.songId) ?? { last: 0, count: 0 }
    stats.set(event.songId, { last: Math.max(current.last, event.at), count: current.count + 1 })
  }
  return stats
}

/**
 * `setlist`: the active setlist's songs in its order on top (first appearance counts), then the
 * rest by title. `lastPlayed` / `mostPlayed`: never-played songs at the end, by title.
 */
export function sortSongs(songs: readonly Song[], sort: SongSort, context: { activeSetlist: Setlist | null; stats: Map<string, { last: number; count: number }> }): Song[] {
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
    return sort === 'lastPlayed' ? (stat?.last ?? -1) : (stat?.count ?? -1)
  }
  return list.sort((a, b) => key(b) - key(a) || byTitle(a, b))
}
