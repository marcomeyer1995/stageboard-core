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

/** A smoother over its own window of readings. Playback uses the one shared below. */
export function createAudioClock(window = CLOCK_WINDOW): AudioClock {
  const offsets: number[] = []
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
        return now
      }
      const offset = now - wall
      if (offsets.length > 0 && offset < Math.max(...offsets) - STALE_S) offsets.length = 0
      offsets.push(offset)
      if (offsets.length > window) offsets.shift()
      return Math.max(now, wall + Math.max(...offsets))
    },
    reset() {
      offsets.length = 0
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
 * More callers read it, so the window is longer than one caller's.
 */
export const sharedAudioClock: AudioClock = createAudioClock(CLOCK_WINDOW * 5)
