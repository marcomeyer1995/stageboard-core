import { useEffect } from 'react'
import { useSyncStore } from '../store/useSyncStore'

/**
 * Mounted once in App.tsx. Feeds the browser/OS's own `online`/`offline` events (fired near-
 * instantly when a network interface actually goes down, unlike PouchDB noticing its own
 * connection died - see useSyncStore.ts's `browserOffline` doc comment for the live bug this
 * fixes) into `useSyncStore`, so the sync indicator can flip immediately instead of waiting on
 * a TCP-level timeout.
 *
 * Deliberately one-directional: going offline forces the indicator's aggregate status, but
 * coming back online doesn't need to *do* anything beyond clearing that override - each
 * PouchDB stream resumes and reports its own real status again on its own as soon as requests
 * can succeed.
 */
export function useBrowserOnlineStatus(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !('addEventListener' in window)) return

    const setBrowserOffline = useSyncStore.getState().setBrowserOffline
    const onOffline = () => setBrowserOffline(true)
    const onOnline = () => setBrowserOffline(false)

    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)

    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [])
}
