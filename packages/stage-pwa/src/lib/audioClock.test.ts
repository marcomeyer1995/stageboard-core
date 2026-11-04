import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioClock } from './audioClock'

let wallMs = 0
/** Like the Fire: the audio clock advances in 64 ms steps; `frozen` stops it (a suspended context). */
let frozenAt: number | null = null
/** How far the audio clock is behind the wall clock (time lost while suspended). */
let lostMs = 0
const STEP_MS = 64
const audioMs = () => frozenAt ?? Math.floor((wallMs - lostMs) / STEP_MS) * STEP_MS
const ctx = {
  get currentTime() {
    return audioMs() / 1000
  },
} as unknown as AudioContext

beforeEach(() => {
  wallMs = 64 * 10_000 + 5
  frozenAt = null
  lostMs = 0
  vi.spyOn(Date, 'now').mockImplementation(() => wallMs)
})
afterEach(() => vi.restoreAllMocks())

/** Reads every `everyMs` for `ms`, returns the last estimate's error against the true clock in ms. */
function readFor(clock: ReturnType<typeof createAudioClock>, ms: number, everyMs = 5): number {
  let error = 0
  for (let t = 0; t < ms; t += everyMs) {
    wallMs += everyMs
    error = clock.now(ctx) * 1000 - (frozenAt ?? wallMs - lostMs)
  }
  return error
}

describe('audioClock (shared smoother, 2026-11-04)', () => {
  it('tracks the upper edge of a stepping clock', () => {
    const clock = createAudioClock(200)
    expect(Math.abs(readFor(clock, 400))).toBeLessThan(6)
  })

  it('stays warm across a pause nobody reads during, while the clock runs on', () => {
    const clock = createAudioClock(200)
    readFor(clock, 400)
    wallMs += 30_000 + 37
    // The very first reading after the pause is already on the edge, not up to a step behind.
    expect(Math.abs(clock.now(ctx) * 1000 - wallMs)).toBeLessThan(6)
  })

  it('starts over when the clock lost time (a suspended context, resumed)', () => {
    const clock = createAudioClock(200)
    readFor(clock, 400)
    frozenAt = audioMs()
    readFor(clock, 2_000) // still: read as-is
    expect(clock.now(ctx)).toBe(frozenAt / 1000)
    lostMs = wallMs - frozenAt
    frozenAt = null
    // Resumed: it runs on from where it stopped - the readings from before would put it ahead.
    expect(Math.abs(readFor(clock, 400))).toBeLessThan(6)
  })
})
