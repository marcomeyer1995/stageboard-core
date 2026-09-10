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
    startClick(() => ({ elapsedMs: null, bpm: 120, timeSignature: '4/4', beatAnchors: [], countInBars: 0 }))
    vi.advanceTimersByTime(500)
    expect(fakeCtx.createOscillator).not.toHaveBeenCalled()
  })

  it('schedules an oscillator for each beat that enters the lookahead window', () => {
    // 120 BPM = 500ms/beat. From elapsedMs 0, the first tick's 150ms lookahead has nothing yet;
    // once elapsedMs reaches 350+, beat index 1 (at 500ms) is within the next tick's window.
    let elapsedMs = 0
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [], countInBars: 0 }))

    elapsedMs = 360
    vi.advanceTimersByTime(50) // one tick

    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1)
  })

  it('never schedules the same beat twice across overlapping lookahead windows', () => {
    let elapsedMs = 360
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [], countInBars: 0 }))

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
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [], countInBars: 0 }))

    vi.advanceTimersByTime(50)

    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].frequency.value).toBe(1500)
  })

  it('resets its schedule position when playback pauses (elapsedMs goes null), so resuming re-derives from scratch rather than staying stuck on the old dedup cursor', () => {
    let elapsedMs: number | null = 360
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [], countInBars: 0 }))
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
    const getState = () => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [], countInBars: 0 })
    startClick(getState)
    startClick(getState)

    vi.advanceTimersByTime(50)

    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1)
  })

  it('keeps scheduling at the new spacing after a live tempo nudge mid-song, instead of stalling for real elapsed time to catch up to a beat grid re-quantized from song-start under the new bpm', () => {
    let elapsedMs = 119855 // ~2 minutes in, just shy of a beat boundary at 140bpm
    let bpm = 140 // 428.57ms/beat
    startClick(() => ({ elapsedMs, bpm, timeSignature: '4/4', beatAnchors: [], countInBars: 0 }))

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
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [], countInBars: 0 }))

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

  it('smooths beat spacing to divide each anchor-to-anchor gap evenly, and re-anchors at the crossing with no duplicated or jittered click (#25 follow-up smoothing fix)', () => {
    // 120 BPM = 500ms/beat nominal. Anchor 1 at 2100ms is NOT a whole multiple of 500ms away
    // from anchor 0 (song-start) - exactly the kind of quantization mismatch that used to cause
    // an audible jitter/duplicate right at the crossing. resolveBeatGrid's correctionRatio
    // divides the 2100ms gap into 4 equal 525ms beats instead, so the segment's *last* beat
    // lands exactly on anchor 1 itself (no jump, no double-click) - see metronome.ts.
    const beatAnchors = [{ timeMs: 0 }, { timeMs: 2100 }]
    let elapsedMs = 0
    const started: { time: number; isDownbeat: boolean }[] = []
    fakeCtx.createOscillator = vi.fn(() => {
      const osc = new FakeOscillator()
      // playClickAt sets osc.frequency.value before calling start(), so it's already correct
      // by the time this reads it.
      osc.start = vi.fn((time: number) => started.push({ time, isDownbeat: osc.frequency.value === 1500 }))
      return osc
    })
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors, countInBars: 0 }))

    // Advance continuously in real TICK_INTERVAL_MS-sized steps, the same way real elapsed time
    // progresses - unlike a synthetic instantaneous jump, this always passes through the
    // lookahead window around anchor 1 before the origin itself flips over to it.
    for (let t = 50; t <= 3200; t += 50) {
      elapsedMs = t
      vi.advanceTimersByTime(50)
    }

    // 6 clicks, ALL evenly spaced at the corrected 525ms (not the nominal 500ms) - 4 inside the
    // anchor-to-anchor segment, then 2 more past anchor 1 into the open-ended tail, which reuses
    // that same segment's corrected ratio rather than reverting to the plain nominal bpm. No
    // duplicate at the 2100ms crossing itself.
    expect(started.map((s) => s.time)).toEqual([1000.125, 1000.1, 1000.125, 1000.1, 1000.125, 1000.1])
    // The 4th click - the one landing exactly on anchor 1 (2100ms) - is correctly the downbeat;
    // re-anchoring to the new segment right after it doesn't re-trigger or shift it.
    expect(started.map((s) => s.isDownbeat)).toEqual([false, false, false, true, false, false])
  })

  it('plays a count-in before the first anchor, at the corrected tempo of the first real segment', () => {
    // Same 0/2100ms anchors and 525ms-corrected tempo as above, but with a 1-bar (4-beat)
    // count-in configured - the count-in should start playing 4*525=2100ms before anchor 0
    // (i.e. at elapsedMs -2100+2100=... concretely: 4 clicks before elapsedMs 0, then the real
    // song's own beats continue exactly as the un-count-in test above).
    const beatAnchors = [{ timeMs: 2100 }, { timeMs: 4200 }]
    let elapsedMs = 0
    const started: { time: number; isDownbeat: boolean }[] = []
    fakeCtx.createOscillator = vi.fn(() => {
      const osc = new FakeOscillator()
      osc.start = vi.fn((time: number) => started.push({ time, isDownbeat: osc.frequency.value === 1500 }))
      return osc
    })
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors, countInBars: 1 }))

    // Nothing before elapsedMs 0 exists to simulate - the count-in window (4 beats * 525ms =
    // 2100ms before anchor 0 at 2100ms) starts exactly at elapsedMs 0, so clicks should be
    // audible from the very start of playback, not silence until 2100ms.
    for (let t = 50; t <= 2200; t += 50) {
      elapsedMs = t
      vi.advanceTimersByTime(50)
    }

    // 4 count-in clicks (one per bar-beat, since it's a single 4/4 bar) landing at 525ms
    // intervals from elapsedMs 0, ending exactly on anchor 0 (2100ms) as its own downbeat -
    // count-in and real song share an unbroken 525ms grid, no gap or duplicate at the join.
    expect(started.map((s) => s.time)).toEqual([1000.125, 1000.1, 1000.125, 1000.1])
    expect(started.map((s) => s.isDownbeat)).toEqual([false, false, false, true])
  })

  it('plays a full count-in from a genuinely negative elapsedMs when it does not fit before the first anchor (#25 follow-up: negative-clock count-in)', () => {
    // Marco's real "Wie ein schützender Engel" numbers: first anchor at 346ms, corrected beat
    // length 521.75ms (ratio 1.0435), a 2-bar (8-beat) count-in configured - far more than the
    // 346ms of real lead-in fits. The master clock itself starts at the count-in's own origin,
    // -3828ms (metronome.ts's countInLeadMs), not at 0 - elapsedMs is genuinely negative here,
    // simulating queue.ts/practiceQueue.ts seeding the transport that way.
    const beatAnchors = [{ timeMs: 346 }, { timeMs: 4520 }]
    let elapsedMs = -3828
    const started: { time: number; isDownbeat: boolean }[] = []
    fakeCtx.createOscillator = vi.fn(() => {
      const osc = new FakeOscillator()
      osc.start = vi.fn((time: number) => started.push({ time, isDownbeat: osc.frequency.value === 1500 }))
      return osc
    })
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors, countInBars: 2 }))

    for (let t = -3828 + 50; t <= 900; t += 50) {
      elapsedMs = t
      vi.advanceTimersByTime(50)
    }

    // 8 count-in beats (2 full bars) evenly spaced at 521.75ms, phase-continuous straight into
    // the real first anchor at 346ms (also a downbeat, no gap/duplicate at the join), then the
    // next real beat continues at the same corrected spacing.
    expect(started).toHaveLength(9)
    expect(started.map((s) => s.isDownbeat)).toEqual([false, false, false, true, false, false, false, true, false])
    for (const { time } of started) expect(time).toBeCloseTo(1000.12, 1) // all land within ~25ms of ctx.currentTime + ~0.12s
  })

  it('stops scheduling further clicks once stopped', () => {
    let elapsedMs = 0
    startClick(() => ({ elapsedMs, bpm: 120, timeSignature: '4/4', beatAnchors: [], countInBars: 0 }))
    stopClick()

    elapsedMs = 360
    vi.advanceTimersByTime(500)

    expect(fakeCtx.createOscillator).not.toHaveBeenCalled()
  })
})
