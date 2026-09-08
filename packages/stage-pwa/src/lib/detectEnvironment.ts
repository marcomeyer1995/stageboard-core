/**
 * Best-effort "how is this device running StageBoard" for the Device Ledger (Marco's explicit
 * request) - a plain browser tab, an installed PWA, or a native wrapper (Capacitor, planned but
 * not yet built - see the "no native browser dialogs" memory on this project's PWA/Capacitor
 * risk). Checked in order of specificity: a native wrapper injects `window.Capacitor` itself
 * regardless of `display-mode`, so it's checked first.
 */
export type Environment = 'browser' | 'pwa' | 'native'

export function detectEnvironment(): Environment {
  if ('Capacitor' in window) return 'native'
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa'
  return 'browser'
}
