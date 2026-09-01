import { useEffect } from 'react'
import { syncClock } from './clockSync'

/** How often to re-run the burst handshake - clocks drift slowly, so this doesn't need to be
 * frequent; frequent enough to correct for a tablet waking from sleep or a Stage-Server
 * restart mid-gig. */
const RESYNC_INTERVAL_MS = 60_000

/**
 * Mounted once in App.tsx, same as useAudioSyncReconciler - runs the initial burst handshake
 * on mount and re-syncs on an interval afterwards (docs/00 §4). No workspace/dependency
 * inputs: the Stage-Server URL itself can change at runtime (useStageServerStore), but
 * syncClock() re-reads it on every call, so a plain interval is enough without re-wiring
 * this effect to that store.
 */
export function useClockSync(): void {
  useEffect(() => {
    void syncClock()
    const interval = setInterval(() => void syncClock(), RESYNC_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])
}
