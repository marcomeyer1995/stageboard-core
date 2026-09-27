import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BeatGrid } from 'shared-types'
import { clickTimeline } from './beatGrid'
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

const grid = (...points: [number, number][]): BeatGrid => ({ points: points.map(([bar, timeMs], i) => ({ id: `p${i}`, bar, timeMs })), meters: [] })

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
    startClick(() => ({ elapsedMs: null, timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }) }))
    vi.advanceTimersByTime(500)
    expect(fakeCtx.createOscillator).not.toHaveBeenCalled()
  })

  it('schedules an oscillator for each beat that enters the lookahead window', () => {
    // 120 BPM = 500ms/beat. From elapsedMs 0, the first tick's 150ms lookahead has nothing yet;
    // once elapsedMs reaches 350+, beat index 1 (at 500ms) is within the next tick's window.
    let elapsedMs = 0
    startClick(() => ({ elapsedMs, timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }) }))

    elapsedMs = 360
    vi.advanceTimersByTime(50) // one tick

    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1)
  })

  it('never schedules the same beat twice across overlapping lookahead windows', () => {
    let elapsedMs = 360
    startClick(() => ({ elapsedMs, timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }) }))

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
    startClick(() => ({ elapsedMs, timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }) }))

    vi.advanceTimersByTime(50)

    expect(oscillators).toHaveLength(1)
    expect(oscillators[0].frequency.value).toBe(1500)
  })

  it('resets its schedule position when playback pauses (elapsedMs goes null), so resuming re-derives from scratch rather than staying stuck on the old dedup cursor', () => {
    let elapsedMs: number | null = 360
    startClick(() => ({ elapsedMs, timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }) }))
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
    const getState = () => ({ elapsedMs, timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }) })
    startClick(getState)
    startClick(getState)

    vi.advanceTimersByTime(50)

    expect(fakeCtx.createOscillator).toHaveBeenCalledTimes(1)
  })

  it('keeps scheduling at the new spacing after a live tempo nudge mid-song, instead of stalling for real elapsed time to catch up to a beat grid re-quantized from song-start under the new bpm', () => {
    let elapsedMs = 119855 // ~2 minutes in, just shy of a beat boundary at 140bpm
    let bpm = 140 // 428.57ms/beat
    startClick(() => ({ elapsedMs, timeline: clickTimeline({ bpm, timeSignature: '4/4' }) }))

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
    startClick(() => ({ elapsedMs, timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }) }))

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

  it('clicks evenly between two alignment points and carries that spacing on (docs/14 §5a)', () => {
    // Bar 1 at 0, bar 2 at 2100 ms: four beats of 525 ms, and the same spacing after bar 2.
    const timeline = clickTimeline({ beatGrid: grid([1, 0], [2, 2100]), bpm: 120, timeSignature: '4/4' })
    let elapsedMs = 0
    const clicks: { at: number; isDownbeat: boolean }[] = []
    fakeCtx.createOscillator = vi.fn(() => {
      const osc = new FakeOscillator()
      osc.start = vi.fn((time: number) => clicks.push({ at: Math.round(elapsedMs + (time - fakeCtx.currentTime) * 1000), isDownbeat: osc.frequency.value === 1500 }))
      return osc
    })
    startClick(() => ({ elapsedMs, timeline }))
    for (let t = 50; t <= 3200; t += 50) {
      elapsedMs = t
      vi.advanceTimersByTime(50)
    }
    // Scheduling starts after the first tick, so bar 1's own beat at 0 has passed already.
    expect(clicks.map((c) => c.at)).toEqual([525, 1050, 1575, 2100, 2625, 3150])
    expect(clicks.map((c) => c.isDownbeat)).toEqual([false, false, false, true, false, false])
  })

  it('changes the click spacing between stretches of different tempo, with no phantom beat', () => {
    // Bar 1 at 0 (150 BPM, 400 ms), bar 2 at 1600 (then 100 BPM, 600 ms), bar 3 at 4000.
    const timeline = clickTimeline({ beatGrid: grid([1, 0], [2, 1600], [3, 4000]), bpm: 150, timeSignature: '4/4' })
    let elapsedMs = 0
    const clickTimes: number[] = []
    fakeCtx.createOscillator = vi.fn(() => {
      const osc = new FakeOscillator()
      osc.start = vi.fn((time: number) => clickTimes.push(elapsedMs + (time - fakeCtx.currentTime) * 1000))
      return osc
    })
    startClick(() => ({ elapsedMs, timeline }))
    for (let t = 50; t <= 4000; t += 50) {
      elapsedMs = t
      vi.advanceTimersByTime(50)
    }
    // (Bar 1's own beat at 0 has passed by the first tick.)
    expect(clickTimes.map((t) => Math.round(t))).toEqual([400, 800, 1200, 1600, 2200, 2800, 3400, 4000])
  })

  it('plays the count-in before bar 1 at the first stretch spacing, straight into bar 1', () => {
    // Bar 1 at 2100, bar 2 at 4200 (525 ms beats), one bar of count-in: 0, 525, 1050, 1575.
    const timeline = clickTimeline({ beatGrid: grid([1, 2100], [2, 4200]), bpm: 120, timeSignature: '4/4', countInBars: 1 })
    let elapsedMs = 0
    const clickTimes: { at: number; isDownbeat: boolean }[] = []
    fakeCtx.createOscillator = vi.fn(() => {
      const osc = new FakeOscillator()
      osc.start = vi.fn((time: number) => clickTimes.push({ at: Math.round(elapsedMs + (time - fakeCtx.currentTime) * 1000), isDownbeat: osc.frequency.value === 1500 }))
      return osc
    })
    startClick(() => ({ elapsedMs, timeline }))
    for (let t = 20; t <= 2200; t += 50) {
      elapsedMs = t
      vi.advanceTimersByTime(50)
    }
    // The count-in's first beat at 0 has passed by the first tick (20 ms) - unchanged from the
    // anchor-based engine; the start of the count-in is #302's topic.
    expect(clickTimes.map((c) => c.at)).toEqual([525, 1050, 1575, 2100])
    expect(clickTimes.map((c) => c.isDownbeat)).toEqual([false, false, false, true])
  })

  it('plays a full count-in from a genuinely negative elapsedMs (the clock starts before 0:00)', () => {
    // Bar 1 at 346 ms, 2 bars of count-in at 521.75 ms: the clock starts at 346 - 8 x 521.75.
    const timeline = clickTimeline({ beatGrid: grid([1, 346], [2, 2433]), bpm: 120, timeSignature: '4/4', countInBars: 2 })
    const origin = timeline.timeOfBeat(timeline.firstBeat)
    expect(origin).toBeCloseTo(-3828, 0)
    let elapsedMs = origin
    let clicks = 0
    fakeCtx.createOscillator = vi.fn(() => {
      clicks++
      return new FakeOscillator()
    })
    startClick(() => ({ elapsedMs, timeline }))
    for (let t = origin + 10; t <= 900; t += 50) {
      elapsedMs = t
      vi.advanceTimersByTime(50)
    }
    // 7 count-in beats after the start, bar 1 at 346, the beat after it - as with anchors before.
    expect(clicks).toBe(9)
  })

  it('stops scheduling further clicks once stopped', () => {
    let elapsedMs = 0
    startClick(() => ({ elapsedMs, timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }) }))
    stopClick()

    elapsedMs = 360
    vi.advanceTimersByTime(500)

    expect(fakeCtx.createOscillator).not.toHaveBeenCalled()
  })
})

describe('Rehearsal Loop support (#61)', () => {
  const base = { timeline: clickTimeline({ bpm: 120, timeSignature: '4/4' }) }
  const startTimes = () =>
    fakeCtx.createOscillator.mock.results.map((result) => (result.value as FakeOscillator).start.mock.calls[0][0] as number)

  it('stretches the wall-clock delay of a beat by the playback rate', () => {
    // Half speed: the beat at 500 ms of song time is (500 - 430) / 0.5 = 140 ms of wall time away.
    startClick(() => ({ ...base, elapsedMs: 430, playbackRate: 0.5 }))
    vi.advanceTimersByTime(50)
    expect(startTimes()).toHaveLength(1)
    expect(startTimes()[0]).toBeCloseTo(1000.14, 3)
  })

  it('narrows the lookahead in song time at a lower rate, so no beat is queued too early', () => {
    // 150 ms of wall time is only 75 ms of song time at 0.5x: beat 1 (500 ms) is still out of reach.
    startClick(() => ({ ...base, elapsedMs: 360, playbackRate: 0.5 }))
    vi.advanceTimersByTime(50)
    expect(fakeCtx.createOscillator).not.toHaveBeenCalled()
  })

  it('never schedules a beat at or beyond the loop end', () => {
    // Loop 0-500 ms: the beat at exactly 500 ms belongs to the next pass, not this one.
    startClick(() => ({ ...base, elapsedMs: 400, loop: { startMs: 0, endMs: 500 } }))
    vi.advanceTimersByTime(50)
    expect(fakeCtx.createOscillator).not.toHaveBeenCalled()
  })

  it('re-anchors on a backwards jump so a beat on the loop start still sounds', () => {
    let elapsedMs = 480
    startClick(() => ({ ...base, elapsedMs, loop: { startMs: 0, endMs: 500 } }))
    vi.advanceTimersByTime(50) // anchored near the loop end, nothing due
    expect(fakeCtx.createOscillator).not.toHaveBeenCalled()

    elapsedMs = 20 // the loop wrapped
    vi.advanceTimersByTime(50)
    // Beat 0 of the new pass (at song time 0, i.e. 20 ms ago) plays immediately rather than being lost.
    expect(fakeCtx.createOscillator).toHaveBeenCalled()
    expect(startTimes()[0]).toBeLessThan(1000)
  })
})

describe('click spacing with a coarse audio clock (2026-09-27)', () => {
  const startTimes = () =>
    fakeCtx.createOscillator.mock.results.map((result) => (result.value as FakeOscillator).start.mock.calls[0][0] as number)

  it('spaces clicks exactly one beat apart although the audio clock only moves in 21 ms steps', () => {
    // Measured on the band's tablet: count-in clicks meant to be 480 ms apart came 438-513 ms
    // apart, because each click was converted from song time with a coarse currentTime sample.
    let wallMs = 0
    const step = 0.021
    startClick(() => ({ timeline: clickTimeline({ bpm: 125, timeSignature: '4/4', countInBars: 0 }), elapsedMs: wallMs }))
    for (let i = 0; i < 200; i++) {
      wallMs += 50
      // Real timers fire a little irregularly too.
      const jitter = (i % 3) * 7
      fakeCtx.currentTime = 1000 + Math.floor((wallMs + jitter) / 1000 / step) * step
      vi.advanceTimersByTime(50)
    }
    const times = startTimes()
    expect(times.length).toBeGreaterThan(15)
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(0.48, 6)
  })

  it('re-derives the audio time after a real jump, not on step jitter', () => {
    let elapsedMs = 0
    startClick(() => ({ timeline: clickTimeline({ bpm: 120, timeSignature: '4/4', countInBars: 0 }), elapsedMs }))
    for (let i = 0; i < 20; i++) {
      elapsedMs += 50
      fakeCtx.currentTime += 0.05
      vi.advanceTimersByTime(50)
    }
    // A clock-sync correction: song time jumps 120 ms ahead of the audio clock.
    elapsedMs += 120
    for (let i = 0; i < 20; i++) {
      elapsedMs += 50
      fakeCtx.currentTime += 0.05
      vi.advanceTimersByTime(50)
    }
    const times = startTimes()
    const gaps = times.slice(1).map((t, i) => Math.round((t - times[i]) * 1000))
    // One gap shortened by the jump, all others exactly one beat.
    expect(gaps.filter((g) => g !== 500)).toEqual([380])
  })

  it('stays exactly on the beat with the Fire tablet\'s 64 ms clock steps (sometimes 128/192 ms)', () => {
    // Measured 2026-09-27: currentTime moved in 64 ms steps, now and then a doubled or tripled
    // step. Converting a raw reading was up to ~130 ms off, beyond the 50 ms tolerance, so the
    // schedule re-derived every few beats - heard as a 340/450 ms gap in a steady 389 ms click.
    let wallMs = 0
    const start = Date.now()
    let audio = 1000
    startClick(() => ({ timeline: clickTimeline({ bpm: 154.2, timeSignature: '4/4', countInBars: 0 }), elapsedMs: wallMs }))
    for (let i = 0; i < 400; i++) {
      wallMs += 50
      vi.setSystemTime(start + wallMs)
      // The audio clock catches up in whole 64 ms buffers; every 7th time it skips one.
      const target = 1000 + wallMs / 1000
      const step = i % 7 === 3 ? 0.128 : 0.064
      while (audio + step <= target) audio += step
      fakeCtx.currentTime = audio
      vi.advanceTimersByTime(50)
    }
    const times = startTimes()
    const gaps = times.slice(1).map((t, i) => Math.round((t - times[i]) * 1000))
    expect(gaps.length).toBeGreaterThan(40)
    expect(new Set(gaps)).toEqual(new Set([389]))
  })

  it('follows a grid with changing stretches exactly from the first click on, even with the Fire tablet\'s 64 ms clock', () => {
    // Three stretches of 400, 412 and 406 ms beats: every click comes from the grid, and the audio
    // time chain continues from the last click instead of reading the coarse clock again - that
    // scattered the first seconds by ±25 ms on the tablet (2026-09-27).
    const timeline = clickTimeline({ beatGrid: grid([1, 500], [3, 500 + 8 * 400], [5, 500 + 8 * 400 + 8 * 412], [7, 500 + 8 * 400 + 8 * 412 + 8 * 406]), bpm: 150, timeSignature: '4/4' })
    let wallMs = 0
    const start = Date.now()
    let audio = 1000
    startClick(() => ({ timeline, elapsedMs: wallMs }))
    for (let i = 0; i < 300; i++) {
      wallMs += 50
      vi.setSystemTime(start + wallMs)
      const target = 1000 + wallMs / 1000
      while (audio + 0.064 <= target) audio += 0.064
      fakeCtx.currentTime = audio
      vi.advanceTimersByTime(50)
    }
    const times = startTimes()
    const measured = times.slice(1).map((t, i) => Math.round((t - times[i]) * 1000))
    const expected = [...Array(8).fill(400), ...Array(8).fill(412), ...Array(8).fill(406)]
    expect(measured.slice(0, 24)).toEqual(expected.slice(times.length > 24 ? 0 : 0, 24))
  })
})

