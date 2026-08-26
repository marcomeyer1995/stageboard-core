import type { Setlist, ShowState, Song } from 'shared-types'

export interface Queue {
  activeSetlist: Setlist | null
  orderedSongs: Song[]
  currentSong: Song | null
  nextSong: Song | null
}

/** Pure playback-queue logic: song order (catalog or active setlist) + current/next position. */
export function computeQueue(songs: Song[], setlists: Setlist[], showState: ShowState): Queue {
  const activeSetlist = setlists.find((setlist) => setlist.id === showState.activeSetlistId) ?? null

  const orderedSongs = activeSetlist
    ? activeSetlist.songIds
        .map((id) => songs.find((song) => song.id === id))
        .filter((song): song is Song => song !== undefined)
    : songs

  if (orderedSongs.length === 0) return { activeSetlist, orderedSongs, currentSong: null, nextSong: null }

  const index = Math.max(
    0,
    orderedSongs.findIndex((song) => song.id === showState.activeSongId),
  )
  return {
    activeSetlist,
    orderedSongs,
    currentSong: orderedSongs[index] ?? orderedSongs[0],
    nextSong: orderedSongs[index + 1] ?? null,
  }
}

/**
 * Moves one song to play immediately after the current one - the Live-Queue widget's
 * "Als nächstes spielen" action (docs/07 section 3): reorder the running order on the
 * fly, not skip ShowState past whatever's in between. Operates on the setlist's raw id
 * array since that's what's persisted. If the current song isn't in `songIds` (e.g. it
 * was removed from the setlist after the show started), the chosen song lands at the
 * front - still "as next" in the sense that matters when there's no current position to
 * anchor to.
 */
export function reorderToPlayNext(
  songIds: string[],
  songId: string,
  currentSongId: string | null,
): string[] {
  const withoutSong = songIds.filter((id) => id !== songId)
  const currentIndex = currentSongId ? withoutSong.indexOf(currentSongId) : -1
  const insertAt = currentIndex + 1
  return [...withoutSong.slice(0, insertAt), songId, ...withoutSong.slice(insertAt)]
}
