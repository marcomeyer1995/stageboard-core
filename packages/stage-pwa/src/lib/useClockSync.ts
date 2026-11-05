import { useEffect } from 'react'
import { FAST_SAMPLE_COUNT, FAST_SAMPLE_INTERVAL_MS, SAMPLE_INTERVAL_MS, sampleClock, syncClock } from './clockSync'

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
    // The burst locks on at once; then one sample every SAMPLE_INTERVAL_MS keeps the band time
    // within a couple of ms and moves it smoothly (docs/29 §5.6). The burst every minute stays as a
    // fallback - its result only counts while the continuous window is not full yet.
    // For the first seconds the samples come fast, so the window decides after ~5 s, not 20.
    void syncClock()
    const burst = setInterval(() => void syncClock(), RESYNC_INTERVAL_MS)
    let fast = 0
    const fastSample = setInterval(() => {
      void sampleClock()
      if (++fast >= FAST_SAMPLE_COUNT) clearInterval(fastSample)
    }, FAST_SAMPLE_INTERVAL_MS)
    const sample = setInterval(() => void sampleClock(), SAMPLE_INTERVAL_MS)
    return () => {
      clearInterval(burst)
      clearInterval(fastSample)
      clearInterval(sample)
    }
  }, [])
}
