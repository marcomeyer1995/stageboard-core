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
