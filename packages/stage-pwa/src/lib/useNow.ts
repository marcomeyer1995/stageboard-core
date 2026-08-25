import { useEffect, useState } from 'react'

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
