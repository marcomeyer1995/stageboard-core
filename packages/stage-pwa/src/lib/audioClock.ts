import { nativeOutputAudioPerWall, nativeOutputNow } from './nativeOutput'
import { timeBase } from './timeBase'
/** Recent readings of `currentTime - wall clock`, s. The band's Fire tablet advances
 * `currentTime` in 64 ms steps (sometimes 128/192 ms - measured 2026-09-27, output latency
 * 260 ms), so a single reading can be up to ~130 ms behind the real audio clock. Right after a
 * step the reading is exact, so the upper edge of the recent readings tracks the true clock; the
 * window keeps the edge current if the clock pauses or drifts. */
const CLOCK_WINDOW = 40 // readings, ~2 s at one reading per 50 ms (one caller)

export interface AudioClock {
  /** The audio clock's current time, smoothed over its step size. */
  now(ctx: AudioContext): number
  reset(): void
}

/** A clock that hasn't advanced for this long (wall time) isn't running - suspended, or not
 * resumed yet: read as-is, not extrapolated along the wall clock. */
const STILL_S = 0.5
/** A reading this far below the upper edge means the clock lost time (a suspended context,
 * resumed): the old readings no longer describe it. Larger than any step (192 ms). */
const STALE_S = 0.25

/** A smoother over its own window of readings. Playback uses the one shared below. With `holdS`
 * the estimate stays put until the upper edge has moved by more than that: the edge wobbles by a
 * reading interval, and two engines anchoring a few frames apart then got different estimates. */
export function createAudioClock(window = CLOCK_WINDOW, holdS = 0): AudioClock {
  const offsets: number[] = []
  let held: number | null = null
  let context: AudioContext | null = null
  let lastReading: number | null = null
  let movedAt = -Infinity
  return {
    now(ctx) {
      if (ctx !== context) {
        context = ctx
        offsets.length = 0
        lastReading = null
        movedAt = -Infinity
      }
      const now = ctx.currentTime
      const wall = Date.now() / 1000
      if (lastReading !== null && now > lastReading) movedAt = wall
      lastReading = now
      if (wall - movedAt > STILL_S) {
        offsets.length = 0
        held = null
        return now
      }
      const offset = now - wall
      if (offsets.length > 0 && offset < Math.max(...offsets) - STALE_S) {
        offsets.length = 0
        held = null
      }
      offsets.push(offset)
      if (offsets.length > window) offsets.shift()
      const edge = Math.max(...offsets)
      if (held === null || Math.abs(edge - held) > holdS) held = edge
      return Math.max(now, wall + held)
    },
    reset() {
      offsets.length = 0
      held = null
      context = null
      lastReading = null
      movedAt = -Infinity
    },
  }
}

/**
 * The one smoother of the shared AudioContext: click, Web Audio track, stems and announcements
 * place their audio with the same estimate of the audio clock. Each used to keep its own, and the
 * track and stem engines reset theirs at every Play - a fresh smoother on the Fire reads up to a
 * step behind and only climbs to the upper edge over a few seconds, so their audio sat 0-55 ms off
 * the click for the whole run (measured with the reference song, 2026-11-04). Never reset by a
 * caller: the readings stay true across Pause, and the window renews itself (STILL_S, STALE_S).
 * More callers read it, so the window is longer than one caller's; it holds its estimate within
 * 20 ms, so engines anchoring a few frames apart (click and stems at Play) get the same one.
 */
const shared = createAudioClock(CLOCK_WINDOW * 5, 0.02)
/** Read every this often while the context runs, so the first Play after the app starts (or after
 * a long pause) finds the clock already on its edge. */
const WARM_INTERVAL_MS = 50
let warmFor: AudioContext | null = null

/** Starts reading the clock of `ctx` in the background (once per context) - called when the
 * shared AudioContext is created and on every read, so the time service is ready before the first
 * Play. */
export function keepAudioClockWarm(ctx: AudioContext): void {
  if (warmFor === ctx || import.meta.env.MODE === 'test') return
  warmFor = ctx
  const timer = setInterval(() => {
    if (warmFor !== ctx || ctx.state === 'closed') clearInterval(timer)
    else if (ctx.state === 'running') {
      shared.now(ctx)
      timeBase.sample(ctx)
    }
  }, WARM_INTERVAL_MS)
}

/** The audio clock now: from the native output's line while that plays (nativeOutput.ts, docs/30),
 * else from the output timestamps (timeBase.ts, docs/29 step 1) once they are ready, else from the
 * smoother above. */
export const sharedAudioClock: AudioClock = {
  now(ctx) {
    keepAudioClockWarm(ctx)
    const piped = nativeOutputNow(ctx)
    if (piped !== null) return Math.max(ctx.currentTime, piped)
    const smoothed = shared.now(ctx)
    const measured = timeBase.now(ctx)
    return measured === null ? smoothed : Math.max(ctx.currentTime, measured)
  },
  reset: () => shared.reset(),
}

/** Whether `sharedAudioClock` reads a precise clock (native output or time service), not the smoother. */
export function audioClockPrecise(ctx: AudioContext): boolean {
  return nativeOutputNow(ctx) !== null || timeBase.ready(ctx)
}

/** Audio seconds per wall-clock second - from the native output's line while that plays. */
export function audioPerWall(ctx: AudioContext): number {
  return nativeOutputAudioPerWall(ctx) ?? timeBase.audioPerWall(ctx)
}
