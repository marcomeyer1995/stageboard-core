import { describe, expect, it } from 'vitest'
import { MAX_SNAP_WINDOW_MS, randomBaseline, scoreAlignment, snapCues, snapToOnset } from './onsetSnap'

const onsets = [1000, 2000, 2100, 5000].map((timeMs) => ({ timeMs, strength: 3 }))

describe('snapToOnset', () => {
  it('finds the nearest onset within the window, on either side', () => {
    expect(snapToOnset(1030, onsets, 80)?.timeMs).toBe(1000)
    expect(snapToOnset(960, onsets, 80)?.timeMs).toBe(1000)
    expect(snapToOnset(2060, onsets, 80)?.timeMs).toBe(2100) // 40 ms vs 60 ms away
  })

  it('finds nothing when the nearest onset is out of range', () => {
    expect(snapToOnset(3500, onsets, 100)).toBeNull()
    expect(snapToOnset(1500, [], 500)).toBeNull()
  })

  it('never reaches further than the maximum window, however much is asked', () => {
    expect(snapToOnset(1000 + MAX_SNAP_WINDOW_MS + 10, onsets, 10_000)).toBeNull()
    expect(snapToOnset(1000 + MAX_SNAP_WINDOW_MS - 10, onsets, 10_000)?.timeMs).toBe(1000)
  })
})

describe('snapCues', () => {
  it('moves cues onto their onset and reports the shift', () => {
    const snapped = snapCues([{ id: 'a', timeMs: 1040 }, { id: 'b', timeMs: 4990 }], onsets, 60)
    expect(snapped).toEqual([
      { cue: { id: 'a', timeMs: 1000 }, shiftMs: -40 },
      { cue: { id: 'b', timeMs: 5000 }, shiftMs: 10 },
    ])
  })

  it('leaves a cue exactly where it is when nothing is in range', () => {
    expect(snapCues([{ id: 'far', timeMs: 3500 }], onsets, 60)).toEqual([{ cue: { id: 'far', timeMs: 3500 }, shiftMs: 0 }])
  })
})

describe('scoreAlignment', () => {
  it('gives the median error and the hit rate at each tolerance', () => {
    const score = scoreAlignment([1010, 2140, 5300], onsets, [50, 100, 400])
    expect(score.count).toBe(3)
    expect(score.medianErrorMs).toBe(40) // errors 10, 40, 300
    expect(score.hitRates[50]).toBeCloseTo(2 / 3)
    expect(score.hitRates[100]).toBeCloseTo(2 / 3)
    expect(score.hitRates[400]).toBe(1)
  })

  it('reports no median and zero rates without boundaries or onsets', () => {
    expect(scoreAlignment([], onsets)).toMatchObject({ count: 0, medianErrorMs: null, hitRates: { 100: 0 } })
    expect(scoreAlignment([1000], [])).toMatchObject({ medianErrorMs: null, hitRates: { 100: 0 } })
  })
})

describe('randomBaseline', () => {
  it('is reproducible with a seeded generator and shows what a dense onset list gives for free', () => {
    const dense = Array.from({ length: 200 }, (_, index) => ({ timeMs: index * 250, strength: 2 }))
    const seeded = () => {
      let state = 7
      return () => ((state = (state * 48271) % 2147483647) / 2147483647)
    }
    const first = randomBaseline(500, 50_000, dense, [100], seeded())
    const second = randomBaseline(500, 50_000, dense, [100], seeded())
    expect(first).toEqual(second)
    // Onsets every 250 ms: a random time is within 100 ms of one ~80% of the time.
    expect(first.hitRates[100]).toBeGreaterThan(0.7)
  })
})
