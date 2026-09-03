import { useEffect, useRef } from 'react'
import { randomId } from './id'
import type { CapabilityStatus } from './capabilities'
import { advanceSongTracking, diffCapabilities } from './showLogTracking'
import { useCapabilities } from './useCapabilities'
import { useQueue } from './queue'
import { useShowLogStore } from '../store/useShowLogStore'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * Derives show-started / song-played / capability-changed events from ShowState and
 * capability changes over time. Mount once, always (App.tsx, like useWakeLock) - it
 * no-ops entirely unless this tablet currently holds the Master-Token, the same trust
 * primitive setActiveEntry already relies on, so only one device ever writes these.
 *
 * Tracks by setlist entry, not bare songId: the same song can appear twice in a setlist
 * (e.g. full version then a shortened encore), and each occurrence must log as its own
 * song-played event rather than being mistaken for one continuous play.
 *
 * The pending-song timer itself lives in `ShowState` (via advanceSongTracking), not in this
 * tablet's own React refs (#4) - so if the Master-Token changes hands mid-song, the incoming
 * master reads the same in-flight `pendingSong` the outgoing one wrote, rather than starting
 * a fresh 20-second window with no memory that a song was already playing.
 */
export function useShowLogTracker(): void {
  const isMaster = useShowStateStore((state) => state.isMaster)
  const showState = useShowStateStore((state) => state.state)
  const recordSongTracking = useShowStateStore((state) => state.recordSongTracking)
  const { currentEntry, currentSong } = useQueue()
  const capabilities = useCapabilities()
  const append = useShowLogStore((state) => state.append)

  const previousCapabilitiesRef = useRef<Map<string, CapabilityStatus> | null>(null)

  useEffect(() => {
    if (!isMaster || currentEntry === null || currentSong === null) return

    const result = advanceSongTracking(
      { pendingSong: showState.pendingSong, currentShowId: showState.currentShowId, lastActivityAt: showState.lastActivityAt },
      { id: currentEntry.id, songId: currentSong.id, songTitle: currentSong.title },
      Date.now(),
      randomId(),
    )
    if (result === null) return

    const { events, nextState } = result
    if (events.songPlayed) void append({ id: randomId(), type: 'song-played', ...events.songPlayed })
    if (events.showStarted) void append({ id: randomId(), type: 'show-started', ...events.showStarted })
    void recordSongTracking(nextState)
    // computeQueue returns fresh objects every render (even with no real change) - depending
    // on entry/song identity (id), not the objects themselves, is what keeps this from
    // re-firing on every unrelated re-render. showState is read fresh above regardless, since
    // it comes from the same render as the dependencies that did change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMaster, currentEntry?.id, currentSong?.id, append, recordSongTracking])

  useEffect(() => {
    if (!isMaster) return
    const showId = showState.currentShowId
    const previous = previousCapabilitiesRef.current
    if (previous && showId) {
      for (const transition of diffCapabilities(previous, capabilities)) {
        void append({
          id: randomId(),
          showId,
          type: 'capability-changed',
          at: Date.now(),
          ...transition,
        })
      }
    }
    previousCapabilitiesRef.current = new Map(capabilities)
  }, [isMaster, capabilities, append, showState.currentShowId])
}
