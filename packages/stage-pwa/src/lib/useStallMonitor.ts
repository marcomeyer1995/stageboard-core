import { useEffect } from 'react'
import { recordStall, recordWatched } from './cueTimingStats'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * Watches the main thread for stalls (long tasks, ≥ 50 ms) while a song plays in Gig mode - the
 * number that sets the cue look-ahead (#477, docs/21 §5): a cue is late only when a stall outlasts
 * the look-ahead minus one scheduler tick. Independent of cues, so every rehearsal on every device
 * measures it. Shown in the Diagnose tab; a browser without the Long Tasks API just records nothing.
 */
export function useStallMonitor(): void {
  const playing = useShowStateStore((state) => state.state.playbackStatus === 'playing')

  useEffect(() => {
    if (!playing || typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) recordStall(entry.duration)
    })
    observer.observe({ type: 'longtask' })
    const startedAt = performance.now()
    return () => {
      observer.disconnect()
      recordWatched(performance.now() - startedAt)
    }
  }, [playing])
}
