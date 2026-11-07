import { isNativeApp } from './native'

/**
 * Best-effort "how is this device running StageBoard" for the Device Ledger (Marco's explicit
 * request) - a plain browser tab, an installed PWA, or the native app (Capacitor, #348). Checked in
 * order of specificity: the native app first. Not by `window.Capacitor`: the web build bundles
 * @capacitor/core, which defines it in every browser too - the laptop's Chrome showed "Nativ"
 * (2026-11-05).
 */
export type Environment = 'browser' | 'pwa' | 'native'

export function detectEnvironment(): Environment {
  if (isNativeApp()) return 'native'
  if (window.matchMedia?.('(display-mode: standalone)').matches) return 'pwa'
  return 'browser'
}
