/** Recent readings of `currentTime - wall clock`, s. The band's Fire tablet advances
 * `currentTime` in 64 ms steps (sometimes 128/192 ms - measured 2026-09-27, output latency
 * 260 ms), so a single reading can be up to ~130 ms behind the real audio clock. Right after a
 * step the reading is exact, so the upper edge of the recent readings tracks the true clock; the
 * window keeps the edge current if the clock pauses or drifts. */
const CLOCK_WINDOW = 40 // readings, ~2 s at one reading per 50 ms

export interface AudioClock {
  /** The audio clock's current time, smoothed over its step size. */
  now(ctx: AudioContext): number
  reset(): void
}

/** One smoother per caller - each keeps its own window of readings (clickEngine.ts, the Web Audio
 * track engine). A clock that isn't running (a context not resumed yet) is read as-is, not
 * extrapolated along the wall clock. */
export function createAudioClock(): AudioClock {
  const offsets: number[] = []
  let lastReading: number | null = null
  let readingsSinceMoved = Infinity
  return {
    now(ctx) {
      const now = ctx.currentTime
      readingsSinceMoved = lastReading !== null && now > lastReading ? 0 : readingsSinceMoved + 1
      lastReading = now
      if (readingsSinceMoved > CLOCK_WINDOW) {
        offsets.length = 0
        return now
      }
      const wall = Date.now() / 1000
      offsets.push(now - wall)
      if (offsets.length > CLOCK_WINDOW) offsets.shift()
      return Math.max(now, wall + Math.max(...offsets))
    },
    reset() {
      offsets.length = 0
      lastReading = null
      readingsSinceMoved = Infinity
    },
  }
}
