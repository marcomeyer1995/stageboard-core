import { useEffect, useState } from 'react'
import { getHostTime } from './clockSync'

/**
 * Re-renders on a fixed interval and returns the current epoch ms. Needed because some
 * state ages instead of changing: a plugin heartbeat goes stale on its own, with no event
 * to react to - and it usually does so while the Master-Clock is stopped (during setup),
 * so useElapsedMs cannot carry that job.
 */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}

/**
 * useNow in band time (the Host's clock, clockSync.ts) - for comparing against anything
 * the Host stamped, like a plugin heartbeat's `lastSeenAt`. The Fire's own clock ran 14 s
 * fast (2026-11-06): every 5-s heartbeat looked 14 s old on arrival and stale a second later, so
 * all server capabilities flipped to "degraded" and back every 5 s, the Master logged each flip,
 * and the sync indicator never settled.
 */
export function useHostNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => getHostTime())

  useEffect(() => {
    const timer = setInterval(() => setNow(getHostTime()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}
