import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clickTimeline } from './beatGrid'
import { __resetClickEngineForTests, startClick } from './clickEngine'

// The time service as it reads a Redmi in the app (docs/29 §11): precise, the audio clock 247 ppm
// slower than the wall clock the song runs on.
const PPM = -247
vi.mock('./timeBase', () => ({ timeBase: { ready: () => true, now: (ctx: AudioContext) => ctx.currentTime, audioPerWall: () => 1 + PPM * 1e-6, sample: () => {} } }))

const starts: number[] = []
let t0 = 0
class FakeAudioContext {
  destination = {}
  state = 'running'
  get currentTime() {
    return 1000 + ((Date.now() - t0) / 1000) * (1 + PPM * 1e-6)
  }
  createOscillator = vi.fn(() => ({ frequency: { value: 0 }, connect: vi.fn(), start: (when: number) => starts.push(when), stop: vi.fn() }))
  createGain = vi.fn(() => ({ gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }))
  resume = vi.fn().mockResolvedValue(undefined)
}

beforeEach(() => {
  vi.useFakeTimers()
  t0 = Date.now()
  starts.length = 0
  const ctx = new FakeAudioContext()
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      return ctx
    }),
  )
})
afterEach(() => {
  __resetClickEngineForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('click follows the song clock, not the audio clock (docs/29 step 2)', () => {
  it('stays on the beat for three minutes although the audio clock runs 247 ppm slow', () => {
    startClick(() => ({ elapsedMs: Date.now() - t0, timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }) }))
    vi.advanceTimersByTime(180_000)
    // When each click is heard on the wall clock, against its beat (one every 500 ms).
    const errors = starts.map((when, i) => ((when - 1000) / (1 + PPM * 1e-6)) * 1000 - (i + 1) * 500)
    const spread = Math.max(...errors) - Math.min(...errors)
    // Uncorrected it drifts 44 ms in three minutes and then jumps.
    expect(spread).toBeLessThan(2)
    expect(starts.length).toBeGreaterThan(350)
  })
})
