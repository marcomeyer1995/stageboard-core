import { describe, expect, it } from 'vitest'
import type { BeatGrid } from 'shared-types'
import { applySectionRamp, applySectionTempo, beatsBetween, clickTimeline, gridFromBeats, gridStretches, newGrid, removePoint, setGradual, setMeter, setPoint, tempoFromTaps, tempoTrendFromTaps } from './beatGrid'

const grid = (...points: [number, number][]): BeatGrid => ({ points: points.map(([bar, timeMs], i) => ({ id: `p${i}`, bar, timeMs })), meters: [] })
const times = (g: BeatGrid, from: number, to: number, bpm = 120, ts = '4/4') => beatsBetween(clickTimeline({ beatGrid: g, bpm, timeSignature: ts }), from, to).map((b) => Math.round(b.timeMs))

describe('clickTimeline', () => {
  it('with one point runs evenly at the variant tempo from bar 1', () => {
    const t = clickTimeline({ beatGrid: grid([1, 2000]), bpm: 120, timeSignature: '4/4' })
    expect(beatsBetween(t, 0, 4000)).toEqual([
      { beat: 0, timeMs: 2000, bar: 1, beatInBar: 0 },
      { beat: 1, timeMs: 2500, bar: 1, beatInBar: 1 },
      { beat: 2, timeMs: 3000, bar: 1, beatInBar: 2 },
      { beat: 3, timeMs: 3500, bar: 1, beatInBar: 3 },
      { beat: 4, timeMs: 4000, bar: 2, beatInBar: 0 },
    ])
    expect(t.rigid).toBe(false)
  })

  it('without a grid starts bar 1 at 0:00', () => {
    expect(clickTimeline({ bpm: 120, timeSignature: '4/4' }).bar1Ms).toBe(0)
  })

  it('splits the bars between two points evenly and carries that tempo on after the last one', () => {
    // Bar 1 at 1 s, bar 9 at 16.8 s: 32 beats in 15.8 s.
    const t = clickTimeline({ beatGrid: grid([1, 1000], [9, 16800]), bpm: 120, timeSignature: '4/4' })
    const period = 15800 / 32
    expect(t.timeOfBeat(32)).toBe(16800)
    expect(t.timeOfBeat(16)).toBeCloseTo(1000 + 16 * period)
    expect(t.timeOfBeat(36)).toBeCloseTo(16800 + 4 * period)
    expect(t.rigid).toBe(true)
  })

  it('extrapolates the first stretch before the first point and counts the count-in back from bar 1', () => {
    const t = clickTimeline({ beatGrid: grid([3, 5000], [5, 9000]), bpm: 120, timeSignature: '4/4', countInBars: 1 })
    expect(t.bar1Ms).toBe(1000)
    expect(t.firstBeat).toBe(-4)
    expect(t.timeOfBeat(-4)).toBe(-1000)
    expect([-4, -3, -1].map((b) => t.beatInBar(b))).toEqual([0, 1, 3])
    expect(t.barOf(-1)).toBe(0)
  })

  it('finds the beat at or before a time exactly on and between beats', () => {
    const t = clickTimeline({ beatGrid: grid([1, 1000], [2, 3100]), bpm: 120, timeSignature: '4/4' })
    expect(t.beatAtOrBefore(3100)).toBe(4)
    expect(t.beatAtOrBefore(3099)).toBe(3)
    expect(t.beatAtOrBefore(999)).toBe(-1)
  })

  it('counts a 2/4 bar with two beats and keeps later bars on their points', () => {
    const g = setMeter(setMeter(grid([1, 0], [6, 9000]), 3, '2/4'), 4, '4/4')
    const t = clickTimeline({ beatGrid: g, bpm: 120, timeSignature: '4/4' })
    expect(t.barStartBeat(4)).toBe(10)
    expect(t.barStartBeat(6)).toBe(18)
    expect([8, 9, 10].map((b) => t.beatInBar(b))).toEqual([0, 1, 0])
    expect(t.timeOfBeat(18)).toBe(9000)
    expect(t.timeSignatureAt(8)).toBe('2/4')
  })

  it('keeps a meter change after the last point', () => {
    const t = clickTimeline({ beatGrid: setMeter(grid([1, 0], [3, 4000]), 5, '3/4'), bpm: 120, timeSignature: '4/4' })
    // Bar 5 at 8 s in 3/4: downbeats every 1.5 s from there.
    const downbeats = beatsBetween(t, 7900, 13000).filter((b) => b.beatInBar === 0).map((b) => b.timeMs)
    expect(downbeats).toEqual([8000, 9500, 11000, 12500])
  })
})

describe('gridStretches', () => {
  it('gives the tempo of each stretch', () => {
    const stretches = gridStretches(grid([1, 0], [5, 9600], [9, 14400]), 100, '4/4')
    expect(stretches.map((s) => Math.round(s.bpm))).toEqual([100, 200])
  })

  it('with one point is the variant tempo', () => {
    expect(gridStretches(grid([1, 500]), 133, '4/4')).toMatchObject([{ fromBar: 1, toBar: null, fromMs: 500, toMs: null, bpm: 133, gradual: false }])
  })
})

describe('editing points', () => {
  it('moving a point only moves the bars between its neighbours', () => {
    const g = grid([1, 1000], [5, 9000], [9, 17000])
    const before = times(g, 0, 20000)
    const after = times(setPoint(g, 5, 9200, '4/4')!, 0, 20000)
    expect(after[0]).toBe(before[0])
    expect(after[16]).toBe(9200)
    expect(after[32]).toBe(before[32]) // bar 9 stays
    expect(after[8]).not.toBe(before[8]) // bar 3, in between, stretched
  })

  it('refuses a move past a neighbouring point, before 0:00 or to an absurd tempo', () => {
    const g = grid([1, 1000], [5, 9000], [9, 17000])
    expect(setPoint(g, 5, 17500, '4/4')).toBeNull()
    expect(setPoint(g, 1, -100, '4/4')).toBeNull()
    expect(setPoint(g, 3, 1100, '4/4')).toBeNull() // 8 beats in 0.1 s
    expect(setPoint(g, 3, 5050, '4/4')?.points.map((p) => p.bar)).toEqual([1, 3, 5, 9])
  })

  it('with a single point, moving it shifts the whole ruler', () => {
    expect(times(setPoint(newGrid(1000), 1, 1300, '4/4')!, 0, 1800)).toEqual([1300, 1800])
  })

  it('never removes the last point', () => {
    const g = grid([1, 1000])
    expect(removePoint(g, 'p0')).toBe(g)
    expect(removePoint(grid([1, 1000], [9, 17000]), 'p1').points).toHaveLength(1)
  })
})

describe('tempoFromTaps', () => {
  it('takes the slope through the taps - scatter and a constant latency do not matter', () => {
    const taps = Array.from({ length: 16 }, (_, i) => 260 + 5000 + i * 444.4 + (i % 3 === 0 ? 25 : -15))
    expect(tempoFromTaps(taps)).toBeCloseTo(135, 0)
  })

  it('counts a missed tap as a two-beat gap', () => {
    expect(tempoFromTaps([0, 500, 1000, 2000, 2500, 3000, 3500])).toBe(120)
  })

  it('needs at least four taps', () => {
    expect(tempoFromTaps([0, 500, 1000])).toBeNull()
  })
})

describe('gridFromBeats ("Track analysieren")', () => {
  const detected = (periods: number[], startMs = 1000, firstBeatInBar = 0) => {
    const out = [{ timeMs: startMs, beatInBar: firstBeatInBar }]
    periods.forEach((p, i) => out.push({ timeMs: out[i]!.timeMs + p, beatInBar: (firstBeatInBar + i + 1) % 4 }))
    return out
  }

  it('turns a steady track into two points', () => {
    const g = gridFromBeats(detected(Array(64).fill(444.4)), 135, '4/4')!
    expect(g.points.map((p) => p.bar)).toEqual([1, 17])
    expect(g.points[0]!.timeMs).toBe(1000)
  })

  it('starts bar 1 on the first detected downbeat', () => {
    const g = gridFromBeats(detected(Array(40).fill(500), 1000, 2), 120, '4/4')!
    expect(g.points[0]!.timeMs).toBe(2000) // beats 3 and 4 before it are left to the count-in
  })

  it('adds a few points where the grid would drift more than 40 ms from the detected downbeats', () => {
    // 32 beats at 450 ms, then 32 at 430 ms: a straight line from first to last misses the middle.
    const beats = detected([...Array(32).fill(450), ...Array(32).fill(430)])
    const g = gridFromBeats(beats, 136, '4/4')!
    expect(g.points.length).toBeGreaterThanOrEqual(3)
    expect(g.points.length).toBeLessThanOrEqual(4)
    const t = clickTimeline({ beatGrid: g, bpm: 136, timeSignature: '4/4' })
    const worst = Math.max(...beats.map((b, i) => Math.abs(t.timeOfBeat(i) - b.timeMs)))
    expect(worst).toBeLessThan(40)
  })

  it('ignores a single detection off by the detector\'s scatter', () => {
    const beats = detected(Array(64).fill(500))
    beats[32]!.timeMs += 60 // bar 9's downbeat detected 60 ms late, its neighbours on time
    expect(gridFromBeats(beats, 120, '4/4')!.points.map((p) => p.bar)).toEqual([1, 17])
  })

  it('does not shift the bar count when a beat was missed', () => {
    const periods = Array(32).fill(500)
    periods.splice(10, 2, 1000) // beats 11 and 12 merged: one detection missing
    const g = gridFromBeats(detected(periods), 120, '4/4')!
    expect(g.points.map((p) => [p.bar, p.timeMs])).toEqual([[1, 1000], [9, 1000 + 32 * 500]])
  })

  it('is null without a downbeat', () => {
    expect(gridFromBeats([{ timeMs: 100, beatInBar: 1 }], 120, '4/4')).toBeNull()
  })
})

describe('applySectionTempo (#329)', () => {
  // 120 BPM, 4/4: a bar is 2 s, bar 16 starts at 30 s. Taps at 100 BPM (600 ms apart).
  const single: BeatGrid = { points: [{ id: 'a', bar: 1, timeMs: 0 }], meters: [] }
  const taps = (fromMs: number, count: number) => Array.from({ length: count }, (_, i) => fromMs + i * 600)

  it('tapping from the only point with nothing after it just sets the bpm', () => {
    expect(applySectionTempo(single, 120, '4/4', taps(100, 8), 100)).toEqual({ kind: 'bpm' })
  })

  it('from bar 16 on: bar 16 stays where it was, the tapped tempo runs to the bar the taps reached', () => {
    const result = applySectionTempo(single, 120, '4/4', taps(30100, 8), 100)
    expect(result).toMatchObject({ kind: 'grid', startBar: 16, endBar: 18, nextBar: null })
    if (result.kind !== 'grid') return
    expect(result.grid.points.map((p) => [p.bar, p.timeMs])).toEqual([[1, 0], [16, 30000], [18, 34800]])
    const timeline = clickTimeline({ beatGrid: result.grid, bpm: 120, timeSignature: '4/4' })
    expect(timeline.timeOfBeat(timeline.barStartBeat(9))).toBe(16000) // before: unchanged
    expect(timeline.timeOfBeat(timeline.barStartBeat(17))).toBe(32400) // 100 BPM from bar 16
  })

  it('late taps (device delay) change nothing as long as they start in the same bar', () => {
    const onTime = applySectionTempo(single, 120, '4/4', taps(30100, 8), 100)
    const late = applySectionTempo(single, 120, '4/4', taps(30400, 8), 100)
    expect(late.kind === 'grid' && onTime.kind === 'grid' && late.grid.points.map((p) => p.timeMs)).toEqual(onTime.kind === 'grid' && onTime.grid.points.map((p) => p.timeMs))
  })

  it('stops before the next alignment point, which stays untouched', () => {
    const grid: BeatGrid = { points: [{ id: 'a', bar: 1, timeMs: 0 }, { id: 'q', bar: 20, timeMs: 38000 }], meters: [] }
    const result = applySectionTempo(grid, 120, '4/4', taps(30100, 40), 100)
    expect(result).toMatchObject({ kind: 'grid', startBar: 16, endBar: 19, nextBar: 20 })
    if (result.kind !== 'grid') return
    expect(result.grid.points.map((p) => [p.bar, p.timeMs])).toEqual([[1, 0], [16, 30000], [19, 37200], [20, 38000]])
  })

  it('says so when there is no room before the next point', () => {
    const grid: BeatGrid = { points: [{ id: 'a', bar: 1, timeMs: 0 }, { id: 'q', bar: 17, timeMs: 32000 }], meters: [] }
    const result = applySectionTempo(grid, 120, '4/4', taps(30100, 8), 100)
    expect(result.kind).toBe('refused')
  })
})

describe('gradual tempo stretches (#354)', () => {
  // 4/4: bars 1-5 constant 120 BPM (16 beats, 8 s), then a ritardando over bars 5-9 to 90 BPM:
  // spacing 500 -> 666.7 ms over 16 beats = 16 x 583.3 = 9333 ms.
  const ritGrid = (): BeatGrid => setGradual(grid([1, 0], [5, 8000], [9, 17333]), 'p1', true)

  it('changes the beat spacing evenly from the arriving tempo to the end tempo', () => {
    const t = clickTimeline({ beatGrid: ritGrid(), bpm: 120, timeSignature: '4/4' })
    expect(t.periodAfter(15)).toBeCloseTo(500, 0) // last beat before the stretch
    expect(60000 / t.periodAfter(16)).toBeCloseTo(119, 0) // starts at ~120 BPM
    expect(60000 / t.periodAfter(31)).toBeCloseTo(90.5, 0) // ends at ~90 BPM
    // Monotonic slowing, and the stretch still lands exactly on its points.
    for (let b = 16; b < 31; b++) expect(t.periodAfter(b + 1)).toBeGreaterThan(t.periodAfter(b))
    expect(t.timeOfBeat(16)).toBeCloseTo(8000, 6)
    expect(t.timeOfBeat(32)).toBeCloseTo(17333, 6)
    // After the last point the end tempo carries on.
    expect(t.periodAfter(40)).toBeCloseTo(666.7, 0)
    expect(t.periodAfter(40)).toBeCloseTo(t.periodAfter(35), 9)
  })

  it('time and beat lookups stay exact inverses inside a gradual stretch', () => {
    const t = clickTimeline({ beatGrid: ritGrid(), bpm: 120, timeSignature: '4/4' })
    for (let b = 0; b < 40; b++) {
      expect(t.beatAtOrBefore(t.timeOfBeat(b))).toBe(b)
      expect(t.beatAtOrBefore(t.timeOfBeat(b) + 5)).toBe(b)
    }
  })

  it('without the flag everything is constant exactly as before', () => {
    const plain = grid([1, 0], [5, 8000], [9, 17333])
    const t = clickTimeline({ beatGrid: plain, bpm: 120, timeSignature: '4/4' })
    expect(t.periodAfter(16)).toBeCloseTo(t.periodAfter(30), 9)
    expect(times(plain, 0, 2000)).toEqual([0, 500, 1000, 1500, 2000])
  })

  it('gridStretches reports start and end tempo of a gradual stretch', () => {
    const [, rit] = gridStretches(ritGrid(), 120, '4/4')
    expect(rit).toMatchObject({ fromBar: 5, toBar: 9, gradual: true })
    expect(rit!.startBpm).toBeGreaterThan(115)
    expect(rit!.endBpm).toBeLessThan(95)
  })

  it('setGradual toggles the flag and setPoint keeps it when the point moves', () => {
    const g = ritGrid()
    expect(setGradual(g, 'p1', false).points[1]).toEqual({ id: 'p1', bar: 5, timeMs: 8000 })
    expect(setPoint(g, 5, 8100, '4/4')!.points.find((p) => p.bar === 5)!.gradual).toBe(true)
  })
})

describe('tempoTrendFromTaps (#354)', () => {
  const tapsFor = (periods: number[], jitter: (i: number) => number = () => 0) => {
    const out = [10_000]
    for (const p of periods) out.push(out[out.length - 1]! + p)
    return out.map((t, i) => t + jitter(i))
  }
  const ritardando = Array.from({ length: 15 }, (_, i) => 500 + ((666.7 - 500) * i) / 14)

  it('steady taps: one tempo', () => {
    expect(tempoTrendFromTaps(tapsFor(Array(12).fill(500)))).toEqual({ kind: 'steady', bpm: 120 })
  })

  it('an even ritardando 120 -> 90 is recognised with start and end tempo', () => {
    const trend = tempoTrendFromTaps(tapsFor(ritardando, (i) => (i % 2 ? 8 : -8)))
    expect(trend?.kind).toBe('gradual')
    if (trend?.kind !== 'gradual') return
    expect(trend.startBpm).toBeGreaterThan(114)
    expect(trend.endBpm).toBeLessThan(96)
  })

  it('a tempo that jumps around is flagged as unsteady', () => {
    const jumpy = [500, 500, 500, 500, 640, 640, 640, 450, 450, 450, 700, 700]
    expect(tempoTrendFromTaps(tapsFor(jumpy))?.kind).toBe('unsteady')
  })
})

describe('applySectionRamp (#354)', () => {
  it('keeps the start bar, marks it gradual and places the end so the stretch ends at the tapped tempo', () => {
    // 120 BPM constant (two points, 4/4), tapping a ritardando from bar 5 (8 s).
    const g = grid([1, 0], [20, 38000])
    const taps = Array.from({ length: 16 }, (_, i) => 8000 + 500 * i + 5 * i * i)
    const result = applySectionRamp(g, 120, '4/4', taps, 90)
    expect(result.kind).toBe('grid')
    if (result.kind !== 'grid') return
    const start = result.grid.points.find((p) => p.bar === result.startBar)!
    expect(result.startBar).toBe(5)
    expect(start.timeMs).toBe(8000)
    expect(start.gradual).toBe(true)
    const t = clickTimeline({ beatGrid: result.grid, bpm: 120, timeSignature: '4/4' })
    const endBeat = t.barStartBeat(result.endBar)
    expect(60000 / t.periodAfter(endBeat - 1)).toBeCloseTo(90, -1)
  })
})

describe('gradual stretch vs. the real ritardando from #354', () => {
  it('lands within ~25 ms of the real beats where the constant grid was off by up to 330 ms', () => {
    // Issue table: ritardando 120 -> 90 BPM over 16 beats, beat 1 at 0 s, beat 16 at 8.75 s.
    // Real beats: 5 -> 2.07 s, 9 -> 4.33 s, 13 -> 6.79 s (constant grid: 2.33 / 4.67 / 7.00 s).
    // 1/4 bars: beat k = bar k. A constant stretch before it gives the arriving 120 BPM.
    const ts = '1/4'
    const g = setGradual(grid([1, -2000], [5, 0], [20, 8750]), 'p1', true)
    const t = clickTimeline({ beatGrid: g, bpm: 120, timeSignature: ts })
    const at = (beatNo: number) => t.timeOfBeat(t.barStartBeat(5 + beatNo - 1))
    const real: Array<[number, number]> = [[5, 2070], [9, 4330], [13, 6790], [16, 8750]]
    for (const [beatNo, ms] of real) expect(Math.abs(at(beatNo) - ms)).toBeLessThan(30)
    const constant = clickTimeline({ beatGrid: grid([1, -2000], [5, 0], [20, 8750]), bpm: 120, timeSignature: ts })
    expect(Math.abs(constant.timeOfBeat(constant.barStartBeat(5 + 8)) - 4330)).toBeGreaterThan(300)
  })
})

