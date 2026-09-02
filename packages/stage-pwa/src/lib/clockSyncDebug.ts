/**
 * Live trace for the NTP-style burst handshake (clockSync.ts, #31) - per-sample RTT/offset
 * within a burst, plus the winning selection, so a noisy-WiFi burst can be inspected sample-
 * by-sample instead of just seeing the final (offset, jitter) the widget shows. Off by default.
 * Enable from the devtools console with `localStorage.setItem('sb:debug:clocksync', '1')` and
 * reload, disable by removing the key.
 */
const KEY = 'sb:debug:clocksync'

export function clockSyncDebugEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function clockSyncLog(...args: unknown[]): void {
  if (clockSyncDebugEnabled()) console.log('[clocksync]', ...args)
}
