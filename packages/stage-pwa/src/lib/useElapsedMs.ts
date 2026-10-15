import { useEffect, useState } from 'react'
import { useClockStore } from '../store/useClockStore'

/**
 * Ticks the calling component with the Master-Clock's current elapsed time.
 * Subscribes directly to accumulatedMs/startedAt (not just isRunning) so a
 * seek() while stopped is reflected immediately, and additionally re-renders
 * every animation frame while running for a smooth, continuously ticking value.
 */
export function useElapsedMs(): number {
  const accumulatedMs = useClockStore((state) => state.accumulatedMs)
  const startedAt = useClockStore((state) => state.startedAt)
  const isRunning = useClockStore((state) => state.isRunning)
  const rate = useClockStore((state) => state.rate)
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (!isRunning) return
    let frame: number
    const tick = () => {
      forceTick((n) => n + 1)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isRunning])

  if (!isRunning || startedAt === null) return accumulatedMs
  // At the clock's rate - slowed down in the Timeline, the playhead must not run ahead of the
  // track and snap back at every position update (Marco, 2026-10-15).
  return accumulatedMs + (Date.now() - startedAt) * rate
}
