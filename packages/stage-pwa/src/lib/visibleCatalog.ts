import { useMemo } from 'react'
import type { Setlist, Song } from 'shared-types'
import { isRigCheckId } from './rigCheckSong'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useSongsStore } from '../store/useSongsStore'

/** The band's songs as lists show them - without the hidden Rig-Check song (#464, docs/24 §5). */
export function useVisibleSongs(): Song[] {
  const songs = useSongsStore((state) => state.songs)
  return useMemo(() => songs.filter((song) => !isRigCheckId(song.id)), [songs])
}

/** The band's setlists as pickers show them - without the hidden Rig-Check setlist. */
export function useVisibleSetlists(): Setlist[] {
  const setlists = useSetlistsStore((state) => state.setlists)
  return useMemo(() => setlists.filter((setlist) => !isRigCheckId(setlist.id)), [setlists])
}
