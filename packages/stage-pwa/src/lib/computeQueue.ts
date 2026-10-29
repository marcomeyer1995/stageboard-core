import { isSongEntry } from 'shared-types'
import type { Setlist, SetlistEntry, ShowState, Song, SongEntry, SongVariant, TrackMeta } from 'shared-types'
import { isRigCheckId } from './rigCheckSong'
import { playableTracks } from './stems'

/** Why a song entry has no variant to play (Marco, 2026-10-18): never another arrangement in its
 * place - falling back to "Original" when the band rehearsed "Akustik" is an absolute no-go on
 * stage. `deleted`: the entry picked a variant that no longer exists. `no-default`: the entry plays
 * the song's default, and the song has none (its default was deleted; one must be set again). */
export type VariantIssue = 'deleted' | 'no-default'

/** One resolved position in the queue: the setlist entry, its song, and the variant it plays.
 * A transition item or section heading (#29) has no song or variant - both are null. */
export interface QueueItem {
  entry: SetlistEntry
  song: Song | null
  variant: SongVariant | null
  variantIssue: VariantIssue | null
}

/** What to call a queue position on screen: the song's title, or the item's own. */
export function queueItemTitle(item: Pick<QueueItem, 'entry' | 'song'>): string {
  return isSongEntry(item.entry) ? (item.song?.title ?? '') : item.entry.title
}

export interface Queue {
  activeSetlist: Setlist | null
  /** Every playable position in order, one per setlist entry (or, with no active setlist,
   * one per catalog song) - the same song can appear more than once, each with its own
   * independently resolved variant. */
  orderedItems: QueueItem[]
  /** Songs only - transition items have none. */
  orderedSongs: Song[]
  /** Null when there is no such position, *or* when it is a transition item (#29) - check the
   * matching `*Entry` with `isSongEntry` to tell the two apart. */
  previousSong: Song | null
  currentSong: Song | null
  nextSong: Song | null
  /** The entries around current - what ShowState.activeEntryId must be set to in order to
   * advance/go back, since a bare songId can't disambiguate two occurrences of the same
   * song. */
  previousEntry: SetlistEntry | null
  currentEntry: SetlistEntry | null
  nextEntry: SetlistEntry | null
  /** The variant actually playing for previous/current/next: that entry's explicit pick, or the
   * song's isDefault variant when it picked none. Null when that variant doesn't exist - see
   * `*VariantIssue` - or the song has no variants at all yet (data from before variants). */
  previousVariant: SongVariant | null
  currentVariant: SongVariant | null
  nextVariant: SongVariant | null
  currentVariantIssue: VariantIssue | null
  nextVariantIssue: VariantIssue | null
  /** What the current position plays - tempo, click, chart: its variant, or the song's own mirror
   * fields only for a song with no variants at all yet. Null on a `currentVariantIssue`, so
   * nothing (click, track, cues, chart) plays a different arrangement in its place. */
  currentArrangement: Song | SongVariant | null
}

/**
 * Which variant an entry resolves to: its own explicit pick, or the song's isDefault variant
 * when it picked none - never one for the other (see VariantIssue). Per-entry (not per-songId)
 * is what lets the same song appear twice in a setlist with two different variants selected.
 */
export function resolveVariantForEntry(
  entry: SongEntry,
  variants: SongVariant[],
): { variant: SongVariant | null; issue: VariantIssue | null } {
  const ofSong = variants.filter((v) => v.songId === entry.songId)
  if (entry.variantId) {
    const selected = ofSong.find((v) => v.id === entry.variantId)
    return selected ? { variant: selected, issue: null } : { variant: null, issue: 'deleted' }
  }
  const byDefault = ofSong.find((v) => v.isDefault)
  if (byDefault) return { variant: byDefault, issue: null }
  // No variants at all: a song from before variants - its own fields are its only arrangement.
  return { variant: null, issue: ofSong.length > 0 ? 'no-default' : null }
}

/**
 * Which track of a variant actually plays: an explicit override first (a for-tonight-only swap
 * - e.g. ShowState.trackOverride when only one of two guitarists could make it, so the "1
 * guitar" mix is needed instead of tonight's usual "no guitar" one), else the setlist entry's
 * own lasting choice (SetlistEntry.trackId), else the variant's own `band-mix` track (the
 * band's default backing track), else whatever track happens to be first. Null only when the
 * variant has no tracks attached at all.
 */
export function resolveTrackForEntry(
  entry: SetlistEntry | null,
  variant: SongVariant | null,
  overrideTrackId: string | null,
): TrackMeta | null {
  // Stems (#9) are never the backing track - only the tracks they were split from.
  const tracks = variant ? playableTracks(variant.tracks) : []
  if (tracks.length === 0) return null
  const entryTrackId = entry && isSongEntry(entry) ? entry.trackId : null
  const requestedId = overrideTrackId ?? entryTrackId
  const requested = requestedId ? tracks.find((t) => t.id === requestedId) : undefined
  return requested ?? tracks.find((t) => t.kind === 'band-mix') ?? tracks[0]!
}

/**
 * The queue, computed once per change of what it is made of (#457): every widget and driver asks
 * for it on every animation frame while a song plays - computed each time, it was 10 % of the
 * Fire's CPU. One cached result per mode (Gig and Solo are both asked every frame), compared by
 * identity: the stores hand out the same arrays until something really changes.
 */
const queueCache: Record<'gig' | 'practice', { args: readonly unknown[]; result: Queue } | null> = { gig: null, practice: null }

export function cachedQueue(
  slot: 'gig' | 'practice',
  songs: Song[],
  setlists: Setlist[],
  activeSetlistId: string | null,
  activeEntryId: string | null,
  variants: SongVariant[],
  currentVariantOverride: string | null = null,
): Queue {
  const args = [songs, setlists, activeSetlistId, activeEntryId, variants, currentVariantOverride] as const
  const hit = queueCache[slot]
  if (hit && hit.args.every((value, i) => value === args[i])) return hit.result
  const result = computeQueue(songs, setlists, { activeSetlistId, activeEntryId }, variants, currentVariantOverride)
  queueCache[slot] = { args, result }
  return result
}

/** Pure playback-queue logic: song order (catalog or active setlist) + current/next position. */
export function computeQueue(
  songs: Song[],
  setlists: Setlist[],
  showState: Pick<ShowState, 'activeSetlistId' | 'activeEntryId'>,
  variants: SongVariant[] = [],
  /** Practice mode's `variantOverride`: swaps the *current* entry's variant (and only that one)
   * when it is a variant of the current song - a stale id from another song is ignored. */
  currentVariantOverride: string | null = null,
): Queue {
  const activeSetlist = setlists.find((setlist) => setlist.id === showState.activeSetlistId) ?? null

  // No active setlist: fall back to the whole catalog, one entry per song, in catalog order.
  // The entry id doubles as the songId here since there's no setlist doc to own a stable id. The
  // hidden Rig-Check song (#464) is never part of the catalog.
  const entries: SetlistEntry[] = activeSetlist
    ? activeSetlist.entries
    : songs.filter((song) => !isRigCheckId(song.id)).map((song) => ({ id: song.id, songId: song.id, variantId: null, trackId: null }))

  const orderedItems: QueueItem[] = entries.flatMap<QueueItem>((entry) => {
    if (!isSongEntry(entry)) return [{ entry, song: null, variant: null, variantIssue: null }]
    const song = songs.find((s) => s.id === entry.songId)
    if (!song) return []
    const { variant, issue } = resolveVariantForEntry(entry, variants)
    return [{ entry, song, variant, variantIssue: issue }]
  })
  const orderedSongs = orderedItems.flatMap((item) => (item.song ? [item.song] : []))

  if (orderedItems.length === 0) {
    return {
      activeSetlist,
      orderedItems: [],
      orderedSongs: [],
      previousSong: null,
      currentSong: null,
      nextSong: null,
      previousEntry: null,
      currentEntry: null,
      nextEntry: null,
      previousVariant: null,
      currentVariant: null,
      nextVariant: null,
      currentVariantIssue: null,
      nextVariantIssue: null,
      currentArrangement: null,
    }
  }

  const index = Math.max(
    0,
    orderedItems.findIndex((item) => item.entry.id === showState.activeEntryId),
  )
  const previous = orderedItems[index - 1] ?? null
  let current = orderedItems[index] ?? orderedItems[0]
  const next = orderedItems[index + 1] ?? null
  const overrideVariant = currentVariantOverride && current.song
    ? variants.find((v) => v.id === currentVariantOverride && v.songId === current.song?.id)
    : undefined
  if (overrideVariant) {
    // `index` is always a valid position here (Math.max(0, ...) on a non-empty list), and the
    // list itself carries the swap too, so e.g. a setlist view shows the variant actually played.
    current = { ...current, variant: overrideVariant, variantIssue: null }
    orderedItems[index] = current
  }
  return {
    activeSetlist,
    orderedItems,
    orderedSongs,
    previousSong: previous?.song ?? null,
    currentSong: current.song,
    nextSong: next?.song ?? null,
    previousEntry: previous?.entry ?? null,
    currentEntry: current.entry,
    nextEntry: next?.entry ?? null,
    previousVariant: previous?.variant ?? null,
    currentVariant: current.variant,
    nextVariant: next?.variant ?? null,
    currentVariantIssue: current.variantIssue,
    nextVariantIssue: next?.variantIssue ?? null,
    currentArrangement: current.variant ?? (current.variantIssue ? null : current.song),
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
