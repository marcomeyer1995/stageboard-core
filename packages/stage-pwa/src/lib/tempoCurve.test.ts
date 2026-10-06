import { describe, expect, it } from 'vitest'
import type { BeatGrid } from 'shared-types'
import { applySectionTempo, clickTimeline, tempoFromTaps } from './beatGrid'
import { gridFromTappedCurve, observationsFromTimes, tempoCurve } from './tempoCurve'

/** Deterministic noise (mulberry32 + Box-Muller). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())

/** Real beat times: segments of [beats, start bpm, end bpm], spacing changing evenly. */
function truth(segments: [number, number, number][]): number[] {
  const out = [1000]
  for (const [n, a, b] of segments) {
    const p0 = 60000 / a
    const p1 = 60000 / b
    for (let x = 0; x < n; x++) out.push(out[out.length - 1]! + p0 + ((p1 - p0) * (x + 0.5)) / n)
  }
  return out
}
const RIT: [number, number, number][] = [
  [32, 120, 120],
  [16, 120, 90],
  [32, 90, 90],
]
const ACCEL: [number, number, number][] = [
  [32, 100, 100],
  [16, 100, 130],
  [32, 130, 130],
]
const bar1At = (t: number): BeatGrid => ({
  points: [{ id: 'p1', bar: 1, timeMs: t }],
  meters: [],
})

/** Worst distance (ms) of the grid's beats from the real ones over beats [from, to). */
function worst(grid: BeatGrid, bpm: number, real: number[], from: number, to: number): number {
  const timeline = clickTimeline({ beatGrid: grid, bpm, timeSignature: '4/4' })
  return Math.max(...real.slice(from, to).map((t, i) => Math.abs(timeline.timeOfBeat(from + i) - t)))
}

/** Taps from bar 7 to bar 18 (beats 24-71): 200 ms device delay, ±`jitter` ms. */
const tapsFor = (real: number[], seed: number, jitter: number) => {
  const r = rng(seed)
  return real.slice(24, 72).map((t) => t + 200 + jitter * gauss(r))
}

describe('observationsFromTimes', () => {
  it('counts a missed beat as two, following the tempo as it slows', () => {
    // 500 ms spacing slowing to 667 ms; the beat at index 9 is missing.
    const real = truth([
      [4, 120, 120],
      [12, 120, 90],
    ])
    const times = real.filter((_, i) => i !== 9)
    const beats = observationsFromTimes(times).map((o) => o.beat)
    expect(beats).toEqual(real.map((_, i) => i).filter((i) => i !== 9))
  })
})

describe('tempoCurve', () => {
  it('follows a ritardando from the taps', () => {
    const real = truth(RIT)
    const curve = tempoCurve(observationsFromTimes(tapsFor(real, 1, 15)))
    expect(curve[0]!.bpm).toBeGreaterThan(114)
    expect(curve[curve.length - 1]!.bpm).toBeLessThan(96)
  })
})

describe('gridFromTappedCurve (#354)', () => {
  it('steady taps stay with the one-tempo path', () => {
    const real = truth([[80, 120, 120]])
    expect(gridFromTappedCurve(bar1At(real[0]!), 120, '4/4', tapsFor(real, 1, 15)).kind).toBe('steady')
  })

  for (const [name, segments] of [
    ['ritardando 120 → 90', RIT],
    ['accelerando 100 → 130', ACCEL],
  ] as const) {
    it(`${name}: the grid lands near the real beats before, during and after the change`, () => {
      const real = truth(segments)
      const bpm = segments[0][1]
      const worstPerRun: number[] = []
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const result = gridFromTappedCurve(bar1At(real[0]!), bpm, '4/4', tapsFor(real, seed, 15))
        expect(result.kind).toBe('grid')
        if (result.kind !== 'grid') return
        expect(result.startBar).toBe(7)
        expect(result.grid.points.length).toBeLessThanOrEqual(6)
        worstPerRun.push(Math.max(worst(result.grid, bpm, real, 24, 32), worst(result.grid, bpm, real, 32, 48), worst(result.grid, bpm, real, 48, 72)))
      }
      // Typically within a flam; now and then the jitter fits another split a little better (the
      // limit of what the taps carry - the true split itself is ~25 ms off on such a run).
      worstPerRun.sort((a, b) => a - b)
      expect(worstPerRun[4]!).toBeLessThan(30)
      expect(worstPerRun[9]!).toBeLessThan(90)
    })
  }

  it('one average tempo, as before, was far off - the reason for this', () => {
    const real = truth(RIT)
    const taps = tapsFor(real, 1, 15)
    const average = applySectionTempo(bar1At(real[0]!), 120, '4/4', taps, tempoFromTaps(taps)!)
    if (average.kind !== 'grid') throw new Error('expected a grid')
    expect(worst(average.grid, 120, real, 32, 72)).toBeGreaterThan(500)
  })

  it('a single wild tap does not move the grid much', () => {
    const real = truth(RIT)
    const taps = tapsFor(real, 4, 15)
    taps[20]! += 150
    const result = gridFromTappedCurve(bar1At(real[0]!), 120, '4/4', taps)
    if (result.kind !== 'grid') throw new Error('expected a grid')
    expect(worst(result.grid, 120, real, 24, 72)).toBeLessThan(60)
  })

  it('reports the tempo change and a curve for the preview', () => {
    const real = truth(RIT)
    const result = gridFromTappedCurve(bar1At(real[0]!), 120, '4/4', tapsFor(real, 2, 15))
    if (result.kind !== 'grid') throw new Error('expected a grid')
    expect(result.startBpm).toBeGreaterThan(112)
    expect(result.endBpm).toBeLessThan(97)
    expect(result.curve.length).toBeGreaterThan(40)
    // The curve hangs from the start bar's grid position, not from the late taps.
    expect(Math.abs(result.curve[0]!.timeMs - real[24]!)).toBeLessThan(40)
  })

  it('keeps points outside the passage and ends before the next one', () => {
    const real = truth(RIT)
    const grid: BeatGrid = {
      points: [
        { id: 'p1', bar: 1, timeMs: real[0]! },
        { id: 'p20', bar: 20, timeMs: Math.round(real[76]!) },
      ],
      meters: [],
    }
    const result = gridFromTappedCurve(grid, 120, '4/4', tapsFor(real, 1, 15))
    if (result.kind !== 'grid') throw new Error('expected a grid')
    expect(result.grid.points.find((p) => p.bar === 1)?.timeMs).toBe(real[0])
    expect(result.grid.points.find((p) => p.bar === 20)?.id).toBe('p20')
    expect(result.endBar).toBeLessThan(20)
  })

  it('refuses when the next point leaves no room', () => {
    const real = truth(RIT)
    const grid: BeatGrid = {
      points: [
        { id: 'p1', bar: 1, timeMs: real[0]! },
        { id: 'p8', bar: 8, timeMs: Math.round(real[28]!) },
      ],
      meters: [],
    }
    expect(gridFromTappedCurve(grid, 120, '4/4', tapsFor(real, 1, 15)).kind).toBe('refused')
  })
})
