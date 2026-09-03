import { useEffect, useState } from 'react'
import { getServerTime } from './clockSync'
import { computeActiveMs } from './playbackTransport'
import { useShowStateStore } from '../store/useShowStateStore'

/**
 * Ticks with the current entry's synced active-playback elapsed time - ShowState-backed
 * (ShowTransportWidget.tsx), so every tablet in the workspace agrees on it, using each
 * tablet's own clockSync.ts offset (getServerTime()) rather than trusting one device's raw
 * clock. Returns null while playbackStatus is 'stopped' (nothing live is running), so callers
 * fall back to a local clock for non-live contexts - e.g. BackingTrackPlayerWidget's
 * home-practice pairing with PrompterWidget never touches ShowState.playbackStatus at all, so
 * it stays 'stopped' and this always returns null there.
 */
export function usePlaybackElapsedMs(): number | null {
  const status = useShowStateStore((state) => state.state.playbackStatus)
  const startedAt = useShowStateStore((state) => state.state.playbackStartedAt)
  const accumulatedMs = useShowStateStore((state) => state.state.playbackAccumulatedMs)
  const [, forceTick] = useState(0)

  useEffect(() => {
    if (status !== 'playing') return
    let frame: number
    const tick = () => {
      forceTick((n) => n + 1)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [status])

  if (status === 'stopped') return null
  return computeActiveMs({ status, startedAt, accumulatedMs }, getServerTime())
}
