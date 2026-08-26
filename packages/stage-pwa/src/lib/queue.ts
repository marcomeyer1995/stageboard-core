import { computeQueue, type Queue } from './computeQueue'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

/** Reactive queue for use in components: current/next song, honoring the active setlist's order. */
export function useQueue(): Queue & { isMaster: boolean } {
  const songs = useSongsStore((state) => state.songs)
  const setlists = useSetlistsStore((state) => state.setlists)
  const showState = useShowStateStore((state) => state.state)
  const isMaster = useShowStateStore((state) => state.isMaster)
  const variants = useSongVariantsStore((state) => state.variants)

  return { ...computeQueue(songs, setlists, showState, variants), isMaster }
}

/** Non-reactive equivalent for imperative callers (e.g. the MIDI trigger handler). */
export function getQueueSnapshot(): Queue {
  return computeQueue(
    useSongsStore.getState().songs,
    useSetlistsStore.getState().setlists,
    useShowStateStore.getState().state,
    useSongVariantsStore.getState().variants,
  )
}

/** Advances to the next song in the queue - only the Master-Token holder may do this. */
export async function advanceToNextSong(): Promise<void> {
  const { isMaster, setActiveEntry } = useShowStateStore.getState()
  if (!isMaster) return
  const { nextEntry } = getQueueSnapshot()
  if (!nextEntry) return
  await setActiveEntry(nextEntry.id)
}
