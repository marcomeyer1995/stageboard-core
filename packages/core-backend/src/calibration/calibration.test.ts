import { describe, expect, it } from 'vitest'
import { matchLatency } from './matchLatency.js'
import { OnsetDetector } from './onsets.js'
import { CALIBRATION_GAPS_MS, irregularSchedule } from './schedule.js'

/** A deterministic pseudo-random sequence, so the tests don't depend on Math.random. */
function seeded(seed: number): () => number {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
}

describe('irregular calibration schedule (#491)', () => {
  it('uses only distinct gaps between consecutive clicks', () => {
    const times = irregularSchedule(10_000, 12, seeded(1))
    const gaps = times.slice(1).map((t, i) => t - times[i]!)
    expect(times).toHaveLength(12)
    expect(new Set(gaps.slice(0, CALIBRATION_GAPS_MS.length)).size).toBe(gaps.slice(0, CALIBRATION_GAPS_MS.length).length)
    for (const gap of gaps) expect(CALIBRATION_GAPS_MS).toContain(gap)
  })
})

describe('matchLatency (#491)', () => {
  const planned = irregularSchedule(10_000, 12, seeded(7))
  const jitter = (i: number) => ((i * 37) % 7) - 3 // -3..+3 ms, deterministic

  it('finds a latency far longer than the gaps - no folding back to a neighbouring click (Marco, 2026-10-13)', () => {
    const onsets = planned.map((t, i) => t + 1200 + jitter(i))
    const result = matchLatency(planned, onsets)!
    expect(result.latencyMs).toBeCloseTo(1200, -1)
    expect(result.matched).toBe(12)
    expect(result.reliable).toBe(true)
  })

  it.each([73, 433, 640])('measures %i ms with missing clicks and room noise in between', (latency) => {
    const onsets = planned.filter((_, i) => i % 4 !== 1).map((t, i) => t + latency + jitter(i))
    const noise = [10_350, 12_900, 15_420, 18_010, 20_777]
    const result = matchLatency(planned, [...onsets, ...noise].sort((a, b) => a - b))!
    expect(Math.abs(result.latencyMs - latency)).toBeLessThanOrEqual(3)
    expect(result.matched).toBe(9)
    expect(result.reliable).toBe(true)
  })

  it('flags a periodic pattern as ambiguous - exactly the trap of one click per second', () => {
    const periodic = Array.from({ length: 12 }, (_, i) => 10_000 + i * 1000)
    const onsets = periodic.map((t) => t + 1200)
    const result = matchLatency(periodic, onsets)!
    // 200 ms explains nearly as many clicks as 1200 ms - no way to tell them apart.
    expect(result.runnerUp).toBeGreaterThan(result.matched / 2)
    expect(result.reliable).toBe(false)
  })

  it('is unreliable when only a few clicks were heard', () => {
    const onsets = planned.slice(0, 3).map((t) => t + 300)
    expect(matchLatency(planned, onsets)!.reliable).toBe(false)
  })

  it('returns null when nothing lies in the delay range', () => {
    expect(matchLatency(planned, [1, 2, 3])).toBeNull()
  })
})

describe('OnsetDetector', () => {
  it('finds a click burst once, across chunk boundaries, and ignores quiet noise', () => {
    const fs = 48_000
    const samples = new Int16Array(fs) // 1 s
    for (let i = 0; i < samples.length; i++) samples[i] = Math.round(Math.sin(i * 0.37) * 40) // quiet hum
    const clickAt = 30_000
    for (let i = 0; i < 1440; i++) samples[clickAt + i] = Math.round(12_000 * Math.sin((2 * Math.PI * 1500 * i) / fs) * Math.exp(-i / 400))
    const detector = new OnsetDetector(fs)
    detector.feed(samples.subarray(0, 30_010))
    detector.feed(samples.subarray(30_010))
    expect(detector.onsets).toHaveLength(1)
    expect(Math.abs(detector.onsets[0]! - clickAt)).toBeLessThan(10)
  })
})

describe('CalibrationRuns (#491)', () => {
  it('plans irregular clicks, records until the longest accepted latency after the last, and reports the delay', async () => {
    const { CalibrationRuns, MAX_LATENCY_MS } = await import('./calibrationRuns.js')
    let now = 100_000
    let finish: (() => void) | null = null
    let heard: number[] = []
    const runs = new CalibrationRuns(
      () => ({ stop: () => {}, onsetsMs: () => heard, error: () => null }),
      () => now,
      (fn) => (finish = fn),
    )
    const run = runs.start(12)!
    expect(run.times[0]).toBe(101_500)
    expect(run.recordUntil).toBe(run.times[11]! + MAX_LATENCY_MS)
    expect(runs.start()).toBeNull() // one at a time
    expect(runs.get(run.id)).toEqual({ state: 'recording', recordUntil: run.recordUntil })

    heard = run.times.map((t) => t + 433)
    now = run.recordUntil
    finish!()
    const status = runs.get(run.id)
    expect(status?.state).toBe('done')
    if (status?.state === 'done') expect(status.result?.latencyMs).toBe(433)
    expect(runs.start()).not.toBeNull() // free again
  })

  it('reports a missing microphone as a failure, not as "no clicks"', async () => {
    const { CalibrationRuns } = await import('./calibrationRuns.js')
    let finish: (() => void) | null = null
    const runs = new CalibrationRuns(() => ({ stop: () => {}, onsetsMs: () => [], error: () => 'Mikrofon am Stage-Server nicht verfügbar' }), () => 0, (fn) => (finish = fn))
    const run = runs.start()!
    finish!()
    expect(runs.get(run.id)).toEqual({ state: 'failed', error: 'Mikrofon am Stage-Server nicht verfügbar' })
  })
})
