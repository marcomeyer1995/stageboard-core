import type { Setlist, SetlistEntry, ShowState, Song, SongVariant } from 'shared-types'

/** One resolved position in the queue: the setlist entry, its song, and the variant it plays. */
export interface QueueItem {
  entry: SetlistEntry
  song: Song
  variant: SongVariant | null
}

export interface Queue {
  activeSetlist: Setlist | null
  /** Every playable position in order, one per setlist entry (or, with no active setlist,
   * one per catalog song) - the same song can appear more than once, each with its own
   * independently resolved variant. */
  orderedItems: QueueItem[]
  orderedSongs: Song[]
  currentSong: Song | null
  nextSong: Song | null
  /** The entries behind current/next - what ShowState.activeEntryId must be set to in order
   * to advance, since a bare songId can't disambiguate two occurrences of the same song. */
  currentEntry: SetlistEntry | null
  nextEntry: SetlistEntry | null
  /** The variant actually playing for current/next: that entry's explicit pick, falling back
   * to the song's isDefault variant, or null if neither exists yet (e.g. Phase 1's lazy
   * per-document migration hasn't touched this song). */
  currentVariant: SongVariant | null
  nextVariant: SongVariant | null
}

/**
 * Which variant an entry resolves to: its own explicit pick, falling back to the song's
 * isDefault variant. Per-entry (not per-songId) is what lets the same song appear twice in a
 * setlist with two different variants selected.
 */
function resolveVariantForEntry(entry: SetlistEntry, variants: SongVariant[]): SongVariant | null {
  const selected = entry.variantId
    ? variants.find((v) => v.id === entry.variantId && v.songId === entry.songId)
    : undefined
  return selected ?? variants.find((v) => v.songId === entry.songId && v.isDefault) ?? null
}

/** Pure playback-queue logic: song order (catalog or active setlist) + current/next position. */
export function computeQueue(
  songs: Song[],
  setlists: Setlist[],
  showState: ShowState,
  variants: SongVariant[] = [],
): Queue {
  const activeSetlist = setlists.find((setlist) => setlist.id === showState.activeSetlistId) ?? null

  // No active setlist: fall back to the whole catalog, one entry per song, in catalog order.
  // The entry id doubles as the songId here since there's no setlist doc to own a stable id.
  const entries: SetlistEntry[] = activeSetlist
    ? activeSetlist.entries
    : songs.map((song) => ({ id: song.id, songId: song.id, variantId: null }))

  const orderedItems: QueueItem[] = entries.flatMap((entry) => {
    const song = songs.find((s) => s.id === entry.songId)
    return song ? [{ entry, song, variant: resolveVariantForEntry(entry, variants) }] : []
  })
  const orderedSongs = orderedItems.map((item) => item.song)

  if (orderedItems.length === 0) {
    return {
      activeSetlist,
      orderedItems: [],
      orderedSongs: [],
      currentSong: null,
      nextSong: null,
      currentEntry: null,
      nextEntry: null,
      currentVariant: null,
      nextVariant: null,
    }
  }

  const index = Math.max(
    0,
    orderedItems.findIndex((item) => item.entry.id === showState.activeEntryId),
  )
  const current = orderedItems[index] ?? orderedItems[0]
  const next = orderedItems[index + 1] ?? null
  return {
    activeSetlist,
    orderedItems,
    orderedSongs,
    currentSong: current.song,
    nextSong: next?.song ?? null,
    currentEntry: current.entry,
    nextEntry: next?.entry ?? null,
    currentVariant: current.variant,
    nextVariant: next?.variant ?? null,
  }
}

/**
 * Moves one entry to play immediately after the current one - the Live-Queue widget's
 * "Als nächstes spielen" action (docs/07 section 3): reorder the running order on the fly,
 * not skip ShowState past whatever's in between. Identifies entries by their own id, not
 * songId, so moving one occurrence of a song that appears twice never touches the other. If
 * the current entry isn't in the list (e.g. it was removed from the setlist after the show
 * started), the chosen entry lands at the front - still "as next" in the sense that matters
 * when there's no current position to anchor to.
 */
export function reorderToPlayNext(
  entries: SetlistEntry[],
  entryId: string,
  currentEntryId: string | null,
): SetlistEntry[] {
  const entry = entries.find((e) => e.id === entryId)
  if (!entry) return entries
  const withoutEntry = entries.filter((e) => e.id !== entryId)
  const currentIndex = currentEntryId ? withoutEntry.findIndex((e) => e.id === currentEntryId) : -1
  const insertAt = currentIndex + 1
  return [...withoutEntry.slice(0, insertAt), entry, ...withoutEntry.slice(insertAt)]
}
