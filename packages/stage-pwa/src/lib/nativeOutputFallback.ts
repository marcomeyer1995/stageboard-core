/**
 * When the native output gives up (Marco, 2026-11-06): after 17 h the phone's WebView rendered its
 * audio up to 0.6 % slower than real time with stalls of 85-128 ms, more than the native output
 * can follow (line 0.25 %, rate control 0.4 %) - its reserve ran empty and 20 % of the audio was
 * missing, the line snapping back in 100 ms jumps. Clean sound on the WebView's own output, even
 * if less exact in time, beats that - so past this much missing audio the device switches itself
 * over until the app restarts, and says so in red.
 */
export const FALLBACK_WINDOW_MS = 10_000
export const FALLBACK_MISSING_MS = 200
/** The first seconds after the output opens don't count - the start's load may cost a few frames. */
export const FALLBACK_GRACE_MS = 15_000

export interface MissingSample {
  at: number
  /** The native output's running count of missing frames. */
  missing: number
}

/** Audio missing over the last FALLBACK_WINDOW_MS, ms (the samples oldest first). */
export function missingInWindowMs(samples: readonly MissingSample[], now: number, rate: number): number {
  const inWindow = samples.filter((s) => s.at >= now - FALLBACK_WINDOW_MS)
  const first = inWindow[0]
  const last = inWindow[inWindow.length - 1]
  if (!first || !last || first === last) return 0
  return Math.max(0, ((last.missing - first.missing) * 1000) / rate)
}

export function shouldFallBack(samples: readonly MissingSample[], now: number, rate: number, openedAt: number): boolean {
  if (now - openedAt < FALLBACK_GRACE_MS) return false
  return missingInWindowMs(samples.filter((s) => s.at >= openedAt + FALLBACK_GRACE_MS), now, rate) >= FALLBACK_MISSING_MS
}
