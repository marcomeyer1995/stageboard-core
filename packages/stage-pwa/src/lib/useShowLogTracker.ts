import { useEffect, useRef } from 'react'
import { randomId } from './id'
import type { CapabilityStatus } from './capabilities'
import { diffCapabilities, shouldConfirmSong, shouldStartNewShow, type PendingSong } from './showLogTracking'
import { useCapabilities } from './useCapabilities'
import { useShowLogStore } from '../store/useShowLogStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'

/**
 * Derives show-started / song-played / capability-changed events from ShowState and
 * capability changes over time. Mount once, always (App.tsx, like useWakeLock) - it
 * no-ops entirely unless this tablet currently holds the Master-Token, the same trust
 * primitive setActiveSong already relies on, so only one device ever writes these.
 *
 * Known limitation, not solved here: each tablet keeps its own in-memory tracking state.
 * If the Master-Token changes hands mid-song, before the outgoing master's 20-second
 * confirmation window closes, that song is never logged - the incoming master has no way
 * to know a song was already in progress. Rare, and a lot simpler than making mastery
 * handoffs also transfer this bookkeeping.
 */
export function useShowLogTracker(): void {
  const isMaster = useShowStateStore((state) => state.isMaster)
  const activeSongId = useShowStateStore((state) => state.state.activeSongId)
  const capabilities = useCapabilities()
  const append = useShowLogStore((state) => state.append)

  const showIdRef = useRef<string | null>(null)
  const lastActivityAtRef = useRef<number | null>(null)
  const pendingRef = useRef<PendingSong | null>(null)
  const previousCapabilitiesRef = useRef<Map<string, CapabilityStatus> | null>(null)

  useEffect(() => {
    if (!isMaster || activeSongId === null) return
    const pending = pendingRef.current
    if (pending && pending.songId === activeSongId) return

    const now = Date.now()

    if (pending && shouldConfirmSong(pending, now)) {
      const showId = showIdRef.current
      if (showId) {
        void append({
          id: randomId(),
          showId,
          type: 'song-played',
          at: pending.startedAt,
          endedAt: now,
          songId: pending.songId,
          songTitle: pending.songTitle,
        })
      }
    }

    if (shouldStartNewShow(lastActivityAtRef.current, now)) {
      const showId = randomId()
      showIdRef.current = showId
      void append({ id: randomId(), showId, type: 'show-started', at: now })
    }
    lastActivityAtRef.current = now

    const song = useSongsStore.getState().songs.find((candidate) => candidate.id === activeSongId)
    pendingRef.current = {
      songId: activeSongId,
      songTitle: song?.title ?? 'Unbekannter Song',
      startedAt: now,
    }
  }, [isMaster, activeSongId, append])

  useEffect(() => {
    if (!isMaster) return
    const showId = showIdRef.current
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
  }, [isMaster, capabilities, append])
}
