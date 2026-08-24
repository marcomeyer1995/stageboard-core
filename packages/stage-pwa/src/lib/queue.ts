import { computeQueue, type Queue } from './computeQueue'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'

/** Reactive queue for use in components: current/next song, honoring the active setlist's order. */
export function useQueue(): Queue & { isMaster: boolean } {
  const songs = useSongsStore((state) => state.songs)
  const setlists = useSetlistsStore((state) => state.setlists)
  const showState = useShowStateStore((state) => state.state)
  const isMaster = useShowStateStore((state) => state.isMaster)

  return { ...computeQueue(songs, setlists, showState), isMaster }
}

/** Non-reactive equivalent for imperative callers (e.g. the MIDI trigger handler). */
export function getQueueSnapshot(): Queue {
  return computeQueue(
    useSongsStore.getState().songs,
    useSetlistsStore.getState().setlists,
    useShowStateStore.getState().state,
  )
}

/** Advances to the next song in the queue - only the Master-Token holder may do this. */
export async function advanceToNextSong(): Promise<void> {
  const { isMaster, setActiveSong } = useShowStateStore.getState()
  if (!isMaster) return
  const { nextSong } = getQueueSnapshot()
  if (!nextSong) return
  await setActiveSong(nextSong.id)
}
