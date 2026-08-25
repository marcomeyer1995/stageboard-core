import { useEffect } from 'react'

/**
 * Keeps the screen from dimming/locking for as long as the app is open - a tablet clamped
 * to a mic stand for a whole set must not go dark mid-song just because its own screen
 * timeout fired. Uses the Screen Wake Lock API (Chrome/Edge/Android since 2020, Safari
 * since 16.4 on both iOS and macOS); on a browser without it, this is a no-op and the
 * device falls back to its normal timeout.
 *
 * The lock itself is released by the platform the moment the page is hidden (switching
 * app, turning the screen off manually, ...) - re-acquiring only once, on mount, would
 * silently stop working again after the very first backgrounding. This re-requests it
 * every time the page becomes visible again instead.
 */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null

    async function acquire() {
      if (document.visibilityState !== 'visible' || sentinel) return
      try {
        sentinel = await navigator.wakeLock.request('screen')
        sentinel.addEventListener('release', () => {
          sentinel = null
        })
      } catch {
        // Denied by the platform (low battery mode, a permissions policy, ...) - nothing
        // to recover from here, the device just keeps its normal screen timeout.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void sentinel?.release()
    }
  }, [])
}
