import { useEffect, useRef } from 'react'
import { randomId } from './id'
import type { CapabilityStatus } from './capabilities'
import { diffCapabilities } from './showLogTracking'
import { useCapabilities } from './useCapabilities'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowLogStore } from '../store/useShowLogStore'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'

/**
 * How long a capability's new status has to hold before it counts as a change (2026-11-08): a
 * heartbeat that wobbles - a server restart, a reconnect, a device clock that is off - flipped all
 * capabilities to "degraded" and back within seconds, and every flip became an entry: 8,127 of the
 * band's 9,484 show-log entries, which every new device has to download. A real outage lasts.
 */
export const CAPABILITY_SETTLE_MS = 10_000

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
 *
 * Compared against the last *logged* state, once the status has been steady for
 * CAPABILITY_SETTLE_MS - a flip that turns back in time logs nothing; a real one keeps the time it
 * started. No baseline before the Stage-Server's first plugin status: until then everything only
 * looks "degraded", and each reload of the master logged that as 7 recoveries.
 */
export function useShowLogTracker(): void {
  // One device even in Pro-Person mode - otherwise each master device logged the same change.
  const isMaster = useShowStateStore(drivesAutomation)
  const currentShowId = useShowStateStore((state) => state.state.currentShowId)
  const healthReceived = usePluginsStore((state) => state.healthReceived)
  const capabilities = useCapabilities()
  const append = useShowLogStore((state) => state.append)

  const loggedRef = useRef<Map<string, CapabilityStatus> | null>(null)
  const changedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (!isMaster || !healthReceived) {
      // Dropped out (or was force-taken over): a later re-claim must not diff against a stale
      // snapshot from before and log capability changes that happened while someone else led (#32).
      loggedRef.current = null
      changedAtRef.current = null
      return
    }
    const logged = loggedRef.current
    if (!logged) {
      loggedRef.current = new Map(capabilities)
      return
    }
    if (diffCapabilities(logged, capabilities).length === 0) {
      changedAtRef.current = null
      return
    }
    const changedAt = changedAtRef.current ?? Date.now()
    changedAtRef.current = changedAt
    const timer = setTimeout(() => {
      if (currentShowId) {
        for (const transition of diffCapabilities(logged, capabilities)) {
          void append({ id: randomId(), showId: currentShowId, type: 'capability-changed', at: changedAt, ...transition })
        }
      }
      loggedRef.current = new Map(capabilities)
      changedAtRef.current = null
    }, CAPABILITY_SETTLE_MS - (Date.now() - changedAt))
    return () => clearTimeout(timer)
  }, [isMaster, healthReceived, capabilities, append, currentShowId])
}
