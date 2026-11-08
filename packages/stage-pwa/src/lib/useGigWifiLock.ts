import { registerPlugin } from '@capacitor/core'
import { useEffect } from 'react'
import { isNativeApp } from './native'
import { useAppModeStore } from '../store/useAppModeStore'

interface WifiLockPlugin {
  acquire: () => Promise<{ held: boolean; lowLatency: boolean }>
  release: () => Promise<void>
}
const WifiLock = registerPlugin<WifiLockPlugin>('WifiLock')

/** Turns the lock off on this device for comparison (localStorage, no UI) - measuring with and
 * without on the same build. */
export const WIFI_LOCK_OFF_KEY = 'sb:debug:wifi-lock-off'

function lockWanted(): boolean {
  try {
    return localStorage.getItem(WIFI_LOCK_OFF_KEY) !== '1'
  } catch {
    return true
  }
}

/**
 * While a Gig is open, the Wi-Fi stays out of power saving (Marco, 2026-11-08): it delayed a pushed
 * Play by up to 125 ms after a pause (measured on the Redmi, docs/25 §6a) - on every device that
 * receives it, eating into the Play lead. Solo practice leaves the Wi-Fi as Android wants it.
 */
export function useGigWifiLock(): void {
  const gig = useAppModeStore((state) => state.mode === 'gig')
  useEffect(() => {
    if (!isNativeApp()) return
    // The native lock outlives a page reload - so not wanting it means letting go actively.
    if (!gig || !lockWanted()) {
      void WifiLock.release().catch(() => undefined)
      return
    }
    void WifiLock.acquire().catch(() => undefined)
    return () => {
      void WifiLock.release().catch(() => undefined)
    }
  }, [gig])
}
