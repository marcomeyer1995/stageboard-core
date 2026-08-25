import { useEffect, useState } from 'react'
import { useViewportStore } from '../store/useViewportStore'

/** True when the app already runs without browser chrome (installed PWA). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const displayModes = ['fullscreen', 'standalone', 'minimal-ui']
  const matchesManifest = displayModes.some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`).matches,
  )
  // iOS predates the display-mode query and reports standalone on navigator instead.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true
  return matchesManifest || iosStandalone
}

/**
 * Fullscreen toggle for the in-browser case. The manifest's `display: fullscreen` only
 * applies to an installed app, and iOS Safari has no Fullscreen API at all - there,
 * "Zum Home-Bildschirm" plus the apple-mobile-web-app-capable meta is the only route.
 * Where it is unsupported the button simply doesn't appear (Graceful Degradation).
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null)

  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement !== null
      setIsFullscreen(active)
      // Also catches Esc and Android's back gesture: leaving fullscreen means this device
      // no longer wants it, and the next launch must not grab it back.
      useViewportStore.getState().setPreferFullscreen(active)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const supported =
    typeof document !== 'undefined' &&
    document.fullscreenEnabled &&
    typeof document.documentElement.requestFullscreen === 'function'

  async function toggle(): Promise<void> {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      }
    } catch {
      // Denied by the browser (no user gesture, permissions policy): nothing to recover.
    }
  }

  return { supported, isFullscreen, toggle }
}

/**
 * Restores fullscreen at the first user gesture after a launch.
 *
 * Two gaps make this necessary. The manifest's `display: fullscreen` is only honoured by
 * Chrome on Android, and only for a *real* installation - over a plain-http origin Chrome
 * merely creates a shortcut that launches in browser context, where the manifest never
 * applies. Safari ignores the field outright.
 *
 * It fires for an installed app, or when this device previously chose fullscreen via the
 * button - never uninvited in a fresh browser tab. A gesture is required because every
 * browser refuses requestFullscreen without one; the tap keeps doing its normal job.
 */
export function useFullscreenOnLaunch(): void {
  const preferFullscreen = useViewportStore((state) => state.preferFullscreen)

  useEffect(() => {
    if (!preferFullscreen && !isStandalone()) return
    if (!document.fullscreenEnabled) return
    if (document.fullscreenElement) return

    const events = ['pointerdown', 'keydown'] as const

    function claim() {
      for (const event of events) window.removeEventListener(event, claim)
      if (document.fullscreenElement) return
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
        // Blocked by a permissions policy or the platform: the app stays standalone.
      })
    }

    for (const event of events) window.addEventListener(event, claim, { once: true })
    return () => {
      for (const event of events) window.removeEventListener(event, claim)
    }
  }, [preferFullscreen])
}
