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

/**
 * A gap in silence is inaudible (Marco, 2026-11-07): the Fire stood idle on Diagnose for five hours
 * after a test, the WebView stopped delivering for ~18 s at 06:26 with no show playing, and the
 * safeguard switched it to the WebView output - for the next gig, until a restart. Losses count only
 * this soon after the mix last carried sound (the worker reports it, SOUND_LEVEL); a gap in a song
 * has sound right before it.
 */
export const SOUND_RECENT_MS = 15_000
/** Peak above which a chunk carries sound, int16 (~ -72 dBFS - the click, a track, an announcement). */
export const SOUND_LEVEL = 8

/** Whether losses count at `now`: sound in the mix within SOUND_RECENT_MS (`soundAt` its last time). */
export function audible(soundAt: number | null, now: number): boolean {
  return soundAt !== null && now - soundAt <= SOUND_RECENT_MS
}

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

/**
 * A stream that came up broken (#837, Redmi + UMC204HD, 2026-11-13): opened ~1 s after the
 * interface was plugged in again, AAudio reported STARTED, no xruns, no missing frames - and played
 * nothing. Its timestamps gave it away: 287 jumps within minutes (healthy: 0-1). Opened again it was
 * fine. Unlike missing audio this shows in silence too, so it counts whether anything sounds or not
 * (not while the screen is locked).
 *
 * BROKEN_JUMPS timestamp jumps within BROKEN_WINDOW_MS: the stream is opened again; broken again
 * within FALLBACK_SPAN_MS of that: the WebView's own output, as for missing audio. Not 3: the Fire's
 * healthy stream jumps by 4-12 ms a few times in its first minute - 4 in 10 s reopened it while
 * playing, the track stood still (2026-11-14); the broken one jumped several times a second.
 */
export const BROKEN_WINDOW_MS = 10_000
export const BROKEN_JUMPS = 10
/** The first seconds after opening don't count - a healthy stream may jump once while it settles. */
export const BROKEN_GRACE_MS = 5000
/** After an output device came or went, the stream is opened again this much later - the device needs
 * a moment before it is ready (opened ~1 s after plugging in, the stream came up broken, #837). */
export const DEVICE_SETTLE_MS = 2000

export interface TimestampSample {
  at: number
  /** The native output's running count of timestamp jumps. */
  timestampJumps: number
}

/** Timestamp jumps over the last BROKEN_WINDOW_MS (the samples oldest first). */
export function timestampJumpsInWindow(samples: readonly TimestampSample[], now: number): number {
  const inWindow = samples.filter((s) => s.at >= now - BROKEN_WINDOW_MS)
  const first = inWindow[0]
  const last = inWindow[inWindow.length - 1]
  if (!first || !last || first === last) return 0
  return Math.max(0, last.timestampJumps - first.timestampJumps)
}

/** What a broken stream leads to: opened again the first time, the WebView's output if it was
 * opened again for that within FALLBACK_SPAN_MS (`reopenedAt`, null: never). */
export function onBrokenStream(reopenedAt: number | null, now: number): 'reopen' | 'fall-back' {
  return reopenedAt !== null && now - reopenedAt <= FALLBACK_SPAN_MS ? 'fall-back' : 'reopen'
}
