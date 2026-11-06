/**
 * When the native output gives up (Marco, 2026-11-06): after 17 h the phone's WebView rendered its
 * audio up to 0.6 % slower than real time with stalls of 85-128 ms, more than the native output
 * can follow (line 0.25 %, rate control 0.4 %) - its reserve ran empty and 20 % of the audio was
 * missing, the line snapping back in 100 ms jumps. Clean sound on the WebView's own output, even
 * if less exact in time, beats that - so the device switches itself over until the app restarts,
 * and says so in red.
 *
 * Only on REPEATED loss (Marco, same day): a single stall of the whole phone (thermal throttling,
 * 2.6 s without audio from the WebView) switched it although the WebView's own output had the same
 * gap - nothing won, exact timing lost until the restart. A loss episode is a 10-s window with
 * FALLBACK_MISSING_MS missing; FALLBACK_EPISODES of them within FALLBACK_SPAN_MS switch over.
 */
export const FALLBACK_WINDOW_MS = 10_000
export const FALLBACK_MISSING_MS = 200
export const FALLBACK_EPISODES = 3
export const FALLBACK_SPAN_MS = 120_000
/**
 * A locked screen is not a fault of the output (Marco, 2026-11-06): while the page is hidden the
 * WebView barely runs, and after unlocking it delivers its audio unevenly while it catches up - on
 * the Redmi that counted as three losses and switched the output. Hidden and this long after
 * becoming visible again, nothing counts.
 */
export const LOCK_GRACE_MS = 5000

/** Until when losses don't count, after the page became hidden (`hidden`) or visible again at `now`. */
export function quietUntil(hidden: boolean, now: number): number {
  return hidden ? Number.POSITIVE_INFINITY : now + LOCK_GRACE_MS
}

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

/**
 * The loss episodes after this status poll (their start times, within FALLBACK_SPAN_MS) and
 * whether this poll began a new one. One episode per 10-s window: a loss is counted once, however
 * many polls still see it.
 */
export function trackLossEpisodes(
  episodes: readonly number[],
  samples: readonly MissingSample[],
  now: number,
  rate: number,
  openedAt: number,
): { episodes: number[]; started: boolean } {
  const kept = episodes.filter((at) => at >= now - FALLBACK_SPAN_MS)
  if (now - openedAt < FALLBACK_GRACE_MS) return { episodes: kept, started: false }
  const counted = samples.filter((s) => s.at >= openedAt + FALLBACK_GRACE_MS)
  const last = kept[kept.length - 1]
  const lossy = missingInWindowMs(counted, now, rate) >= FALLBACK_MISSING_MS
  if (!lossy || (last !== undefined && now - last < FALLBACK_WINDOW_MS)) return { episodes: kept, started: false }
  return { episodes: [...kept, now], started: true }
}

export function shouldFallBack(episodes: readonly number[]): boolean {
  return episodes.length >= FALLBACK_EPISODES
}
