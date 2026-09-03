import { useEffect, useRef } from 'react'
import { randomId } from './id'
import type { CapabilityStatus } from './capabilities'
import { diffCapabilities } from './showLogTracking'
import { useCapabilities } from './useCapabilities'
import { useShowLogStore } from '../store/useShowLogStore'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * Derives capability-changed events from hardware capability changes over time. Mount once,
 * always (App.tsx, like useWakeLock) - it no-ops entirely unless this tablet currently holds
 * the Master-Token, the same trust primitive every other ShowState write relies on, so only
 * one device ever writes these.
 *
 * Song-played / show-started detection used to live here too, watching ShowState for entry
 * changes - it now lives in queue.ts's playSong/pauseSong/stopSong/advanceToNext-/PreviousSong
 * instead (#13): it's always a direct consequence of one of those explicit transport actions,
 * not something to infer reactively from a state diff, so it moved to where those actions are
 * taken. Capability changes are the one part that's still genuinely a reactive watch over
 * time rather than a discrete user action.
 */
export function useShowLogTracker(): void {
  const isMaster = useShowStateStore((state) => state.isMaster)
  const currentShowId = useShowStateStore((state) => state.state.currentShowId)
  const capabilities = useCapabilities()
  const append = useShowLogStore((state) => state.append)

  const previousCapabilitiesRef = useRef<Map<string, CapabilityStatus> | null>(null)

  useEffect(() => {
    if (!isMaster) return
    const previous = previousCapabilitiesRef.current
    if (previous && currentShowId) {
      for (const transition of diffCapabilities(previous, capabilities)) {
        void append({
          id: randomId(),
          showId: currentShowId,
          type: 'capability-changed',
          at: Date.now(),
          ...transition,
        })
      }
    }
    previousCapabilitiesRef.current = new Map(capabilities)
  }, [isMaster, capabilities, append, currentShowId])
}
