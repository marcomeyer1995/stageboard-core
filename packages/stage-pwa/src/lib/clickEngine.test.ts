import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetClickEngineForTests, startClick, stopClick } from './clickEngine'

// happy-dom (vitest.config.ts) has no real Web Audio implementation, so every test here runs
// against a minimal fake standing in for AudioContext/OscillatorNode/GainNode - just enough
// surface for clickEngine.ts to drive, so what's actually under test is the scheduling logic
// (when clicks get created, with what timing, deduped how), not real audio synthesis.
class FakeOscillator {
  frequency = { value: 0 }
  connect = vi.fn()
  start = vi.fn()
  stop = vi.fn()
}
class FakeGain {
  gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }
  connect = vi.fn()
}
class FakeAudioContext {
  currentTime = 1000 // arbitrary non-zero, so bugs that assume 0 don't hide themselves
  destination = {}
  createOscillator = vi.fn(() => new FakeOscillator())
  createGain = vi.fn(() => new FakeGain())
  resume = vi.fn().mockResolvedValue(undefined)
}

let fakeCtx: FakeAudioContext

beforeEach(() => {
  vi.useFakeTimers()
  fakeCtx = new FakeAudioContext()
  // A plain `function`, not an arrow - arrow functions have no [[Construct]] and can never be
  // called with `new`, even wrapped in vi.fn(), and clickEngine.ts does `new AudioContext()`.
  vi.stubGlobal(
    'AudioContext',
    vi.fn(function () {
      return fakeCtx
    }),
  )
})

afterEach(() => {
  __resetClickEngineForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('startClick/stopClick', () => {
  it('does nothing while not playing (elapsedMs null)', () => {
    startClick(() => ({ elapsedMs: null, bpm: 120, timeSignature: '4/4', beatAnchors: [] }))
    vi.advanceTimersByTime(500)
    expect(fakeCtx.createOscillator).not.toHaveBeenCalled()
  })

  it('schedules an oscillator for each beat that enters the lookahead window', () => {
    // 120 BPM = 500ms/beat. From elapsedMs 0, the first tick's 150ms lookahead has nothing yet;
    // once elapsedMs reaches 350+, beat index 1 (at 500ms) is within the next tick's window.
    let elapsedMs = 0
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [] }))

    elapsedMs = 360
    vi.advanceTimersByTime(50) // one tick

    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1)
  })

  it('never schedules the same beat twice across overlapping lookahead windows', () => {
    let elapsedMs = 360
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [] }))

    vi.advanceTimersByTime(50) // ticks at elapsedMs=360, schedules beat 1 (500ms)
    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1)

    elapsedMs = 400 // still within beat 1's lookahead window on the next tick too
    vi.advanceTimersByTime(50)
    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1) // not scheduled again
  })

  it('accents the downbeat with a higher frequency than other beats', () => {
    const elapsedMs = 1860 // 4/4 at 120bpm: beat index 4 (2000ms) is the next downbeat
    const oscillators: FakeOscillator[] = []
    fakeCtx.createOscillator = vi.fn(() => {
      const osc = new FakeOscillator()
      oscillators.push(osc)
      return osc
    })
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [] }))

    vi.advanceTimersByTime(50)

    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].frequency.value).toBe(1500)
  })

  it('resets its schedule position when playback pauses (elapsedMs goes null), so resuming re-derives from scratch rather than staying stuck on the old dedup cursor', () => {
    let elapsedMs: number | null = 360
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [] }))
    vi.advanceTimersByTime(50)
    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1)

    elapsedMs = null // paused
    vi.advanceTimersByTime(50)

    elapsedMs = 360 // resumed at the same position
    vi.advanceTimersByTime(50)
    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(2)
  })

  it('is a no-op to call twice - does not double the scheduling rate', () => {
    const elapsedMs = 360
    const getState = () => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [] })
    startClick(getState)
    startClick(getState)

    vi.advanceTimersByTime(50)

    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1)
  })

  it('keeps scheduling at the new spacing after a live tempo nudge mid-song, instead of stalling for real elapsed time to catch up to a beat grid re-quantized from song-start under the new bpm', () => {
    let elapsedMs = 119855 // ~2 minutes in, just shy of a beat boundary at 140bpm
    let bpm = 140 // 428.57ms/beat
    startClick(() => ({ elapsedMs, bpm, timeSignature: '4/4', beatAnchors: [] }))

    vi.advanceTimersByTime(50) // schedules the imminent beat (elapsedMs 120000)
    const clicksBeforeNudge = fakeCtx.createOscillator.mock.calls.length
    expect(clicksBeforeNudge).toBeGreaterThan(0)

    // A -3% live tempo nudge (TempoNudgeWidget, #140), applied right after that beat - the
    // exact #25 review scenario: on the old index-based dedup this alone stalled the click for
    // ~3.5s of real elapsed time before the next beat's index under the new bpm's grid caught
    // up past the old cursor.
    bpm = 135.8

    let ticksUntilNextClick = 0
    while (fakeCtx.createOscillator.mock.calls.length === clicksBeforeNudge && ticksUntilNextClick < 20) {
      elapsedMs += 50
      vi.advanceTimersByTime(50)
      ticksUntilNextClick++
    }

    // At ~136bpm a beat is ~442ms apart - at most ~10 ticks (500ms) of silence is expected,
    // never the ~70-tick (3.5s) stall the unfixed code produced.
    expect(ticksUntilNextClick).toBeLessThan(15)
  })

  it('resyncs cleanly instead of bursting through every missed beat after the tab was backgrounded and throttled (found live, 2026-09-10: the click went "fully out of rhythm" after losing focus)', () => {
    let elapsedMs = 999855 // large value mid-song, just shy of a beat boundary at 120bpm (500ms/beat)
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [] }))

    vi.advanceTimersByTime(50) // establishes the anchor, schedules the imminent beat
    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1)

    // The tab loses focus: the browser throttles setInterval so hard that, from this
    // scheduler's perspective, real ticks stop arriving - meanwhile elapsedMs (driven by
    // requestAnimationFrame re-renders that are also paused while hidden) freezes too, then
    // jumps straight to the current value once the tab regains focus and a render finally
    // happens - ~20 beats' worth of time (10s) passed in what looks like a single step here.
    elapsedMs += 10000
    fakeCtx.createOscillator.mockClear()
    vi.advanceTimersByTime(50) // the next tick that actually gets to run, post-throttling

    // A resync to the current position, not a burst of every beat that would have fired during
    // the stall - at most 1-2 clicks for this one tick, never anywhere close to the ~20 beats
    // that elapsed during the gap.
    expect(fakeCtx.createOscillator.mock.calls.length).toBeLessThan(3)
  })

  it('re-anchors phase the instant elapsedMs crosses into a new beat anchor mid-song, instead of continuing to extrapolate the old grid (#25 follow-up)', () => {
    // 120 BPM = 500ms/beat. Anchor 0 (song-start) governs the grid until elapsedMs reaches
    // anchor 1 at 5150ms - not a multiple of 500ms away, exactly the kind of irregularity (a
    // bar that didn't line up with straight bpm-math) an anchor is meant to correct.
    const beatAnchors = [{ timeMs: 0 }, { timeMs: 5150 }]
    let elapsedMs = 4950 // just shy of a beat boundary under anchor 0's grid (4950 -> 5000)
    const started: number[] = [] // the `time` argument each oscillator's start() was called with
    fakeCtx.createOscillator = vi.fn(() => {
      const osc = new FakeOscillator()
      osc.start = vi.fn((time: number) => started.push(time))
      return osc
    })
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors }))

    vi.advanceTimersByTime(50) // schedules the beat at 5000ms, still under anchor 0's grid
    expect(started).toHaveLength(1)

    // Cross into anchor 1. The re-anchored next beat is due at 5650ms (500ms after the anchor
    // itself, same "schedule the next beat after now" rule anchorSchedule always follows) - not
    // yet within the 150ms lookahead, so nothing new is scheduled on this exact tick.
    elapsedMs = 5150
    vi.advanceTimersByTime(50)
    expect(started).toHaveLength(1)

    // Advance close to that re-anchored beat.
    elapsedMs = 5520
    vi.advanceTimersByTime(50)

    expect(started).toHaveLength(2)
    // ctx.currentTime is fixed at 1000 in the fake - this scheduled time reflects msFromNow to
    // the re-anchored beat at 5650ms, not the stale 5500ms the pre-crossing grid would have
    // used (0 + 11*500, extrapolated straight from anchor 0 with no correction).
    expect(started[1]).toBeCloseTo(1000 + (5650 - 5520) / 1000)
  })

  it('stops scheduling further clicks once stopped', () => {
    let elapsedMs = 0
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [] }))
    stopClick()

    elapsedMs = 360
    vi.advanceTimersByTime(500)

    expect(fakeCtx.createOscillator).not.toHaveBeenCalled()
  })
})
