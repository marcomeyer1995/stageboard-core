import { isSongEntry, type PracticeLogEntry, type RehearsalWindow, type Setlist, type ShowLogEvent, type Song } from 'shared-types'

/** How the Bibliothek orders its lists (Marco, 2026-10-07) - chosen per tab, remembered per device. */
// Only gig date and name - creation order says nothing (Marco, 2026-10-07).
export type SetlistSort = 'performance' | 'name'
export type SongSort = 'title' | 'artist' | 'setlist' | 'practiced' | 'rehearsed'

/** Option names; bar order A–Z left, Auftritt right (Marco, 2026-10-07). */
// "Name"/"Titel", not "A–Z" - that could mean the artist too (Marco, 2026-10-07).
export const SETLIST_SORT_LABEL: Record<SetlistSort, string> = { name: 'Name', performance: 'Auftritt' }
export const SONG_SORT_LABEL: Record<SongSort, string> = {
  title: 'Titel',
  artist: 'Interpret',
  setlist: 'Setlist',
  // Own Solo-Üben takes in the device's period (Einstellungen → Dieses Gerät).
  practiced: 'Geübt',
  // The band's Gig-mode plays in the band's period - days or last shows (Einstellungen → Band).
  rehearsed: 'Geprobt',
}

/** Per song: how often in the chosen period, and when last (any time; 0 = never). */
export interface PlayCount {
  count: number
  last: number
}

/** The chosen option shows its direction: first tap ↑ ascending, tapping again ↓ descending
 * (Marco, 2026-10-07). The others show just their name, so the bar fits a phone. */
export function sortLabel(name: string, chosen: boolean, descending: boolean): string {
  return chosen ? `${name} ${descending ? '↓' : '↑'}` : name
}

const DAY_MS = 24 * 60 * 60 * 1000

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

/** Per song, for one person: Solo-Üben takes in the last `days` days, and the latest one. */
export function practiceStats(entries: readonly PracticeLogEntry[], profileId: string | null, now: number, days: number): Map<string, PlayCount> {
  const stats = new Map<string, PlayCount>()
  if (!profileId) return stats
  for (const entry of entries) {
    if (entry.profileId !== profileId) continue
    const current = stats.get(entry.songId) ?? { count: 0, last: 0 }
    stats.set(entry.songId, { count: current.count + (now - entry.at <= days * DAY_MS ? 1 : 0), last: Math.max(current.last, entry.at) })
  }
  return stats
}

/**
 * Per song: the band's Gig-mode plays (show log "song-played", 20 s+) in the last `days` days or
 * in the last `shows` shows (a show = all events of one showId, ordered by its latest event),
 * and the latest play.
 */
export function rehearsalStats(events: readonly ShowLogEvent[], window: RehearsalWindow, now: number): Map<string, PlayCount> {
  let inWindow: (event: ShowLogEvent) => boolean
  if (window.kind === 'days') {
    inWindow = (event) => now - event.at <= window.days * DAY_MS
  } else {
    const showEnd = new Map<string, number>()
    for (const event of events) showEnd.set(event.showId, Math.max(showEnd.get(event.showId) ?? 0, event.at))
    const recent = new Set([...showEnd.entries()].sort((a, b) => b[1] - a[1]).slice(0, window.shows).map(([showId]) => showId))
    inWindow = (event) => recent.has(event.showId)
  }
  const stats = new Map<string, PlayCount>()
  for (const event of events) {
    if (event.type !== 'song-played') continue
    const current = stats.get(event.songId) ?? { count: 0, last: 0 }
    stats.set(event.songId, { count: current.count + (inWindow(event) ? 1 : 0), last: Math.max(current.last, event.at) })
  }
  return stats
}

/**
 * `artist`: songs without one at the end. `setlist`: the active setlist's songs in its order
 * (first appearance counts), the others at the end. `practiced` / `rehearsed`: how often in the
 * period - ascending puts the least (what needs practice) first; same count, longest ago first.
 */
export function sortSongs(
  songs: readonly Song[],
  sort: SongSort,
  context: { activeSetlist: Setlist | null; practice: Map<string, PlayCount>; rehearsal: Map<string, PlayCount> },
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
  const stats = sort === 'practiced' ? context.practice : context.rehearsal
  // Same count: the one practised/played longest ago first, never at all before that (Marco,
  // 2026-10-08) - ascending puts what needs it most on top; descending reverses all of it.
  const stat = (song: Song) => stats.get(song.id) ?? { count: 0, last: 0 }
  return [...songs].sort((a, b) => {
    const order = stat(a).count - stat(b).count || stat(a).last - stat(b).last
    return (descending ? -order : order) || byName(a.title, b.title)
  })
}
