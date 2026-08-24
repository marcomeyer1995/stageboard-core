import { useEffect, useState } from 'react'
import { useClockStore } from '../store/useClockStore'

/** Ticks the calling component with the Master-Clock's current elapsed time while it's running. */
export function useElapsedMs(): number {
  const isRunning = useClockStore((state) => state.isRunning)
  const getElapsedMs = useClockStore((state) => state.getElapsedMs)
  const [elapsedMs, setElapsedMs] = useState(getElapsedMs)

  useEffect(() => {
    setElapsedMs(getElapsedMs())
    if (!isRunning) return

    let frame: number
    const tick = () => {
      setElapsedMs(getElapsedMs())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isRunning, getElapsedMs])

  return elapsedMs
}
