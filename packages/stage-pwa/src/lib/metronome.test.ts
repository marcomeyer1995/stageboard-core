import { describe, expect, it } from 'vitest'
import type { BeatGrid } from 'shared-types'
import { clickTimeline } from './beatGrid'
import { adjustedBpm, barMsAt, beatAt, beatsPerBar, countInLeadMs, effectiveClickEnabled } from './metronome'

const grid = (...points: [number, number][]): BeatGrid => ({ points: points.map(([bar, timeMs], i) => ({ id: `p${i}`, bar, timeMs })), meters: [] })
/** A song without a grid: bar 1 at 0:00. */
const plain = (bpm: number, timeSignature = '4/4', countInBars = 0) => clickTimeline({ bpm, timeSignature, countInBars })

function mustBeatAt(...args: Parameters<typeof beatAt>): NonNullable<ReturnType<typeof beatAt>> {
  const beat = beatAt(...args)
  if (beat === null) throw new Error('expected a beat, got none')
  return beat
}

describe('effectiveClickEnabled', () => {
  it('defers to the song default when there is no live override', () => {
    expect(effectiveClickEnabled(true, null)).toBe(true)
    expect(effectiveClickEnabled(false, null)).toBe(false)
  })

  it('forces on/off regardless of the song default when overridden', () => {
    expect(effectiveClickEnabled(false, 'on')).toBe(true)
    expect(effectiveClickEnabled(true, 'off')).toBe(false)
  })
})

describe('adjustedBpm', () => {
  it('is a no-op at 0%', () => {
    expect(adjustedBpm(120, 0)).toBe(120)
  })

  it('applies a positive or negative percent correction', () => {
    expect(adjustedBpm(120, 5)).toBeCloseTo(126)
    expect(adjustedBpm(120, -5)).toBeCloseTo(114)
  })
})

describe('beatsPerBar', () => {
  it('reads the numerator of a normal time signature', () => {
    expect(beatsPerBar('4/4')).toBe(4)
    expect(beatsPerBar('3/4')).toBe(3)
    expect(beatsPerBar('6/8')).toBe(6)
  })

  it('falls back to 4 for anything unparseable, rather than throwing', () => {
    expect(beatsPerBar('')).toBe(4)
    expect(beatsPerBar('waltz')).toBe(4)
    expect(beatsPerBar('0/4')).toBe(4)
    expect(beatsPerBar('-2/4')).toBe(4)
  })
})

describe('beatAt', () => {
  it('is the downbeat at elapsedMs 0 without a grid', () => {
    const beat = mustBeatAt(0, plain(120))
    expect(beat).toEqual(expect.objectContaining({ beatInBar: 0, isDownbeat: true, msIntoBeat: 0, isCountIn: false, effectiveBpm: 120 }))
  })

  it('advances one beat per 500 ms at 120 BPM and wraps at the bar', () => {
    expect([0, 500, 1000, 1500, 2000].map((ms) => mustBeatAt(ms, plain(120)).beatInBar)).toEqual([0, 1, 2, 3, 0])
  })

  it('respects a non-4/4 time signature', () => {
    expect([0, 500, 1000, 1500].map((ms) => mustBeatAt(ms, plain(120, '3/4')).beatInBar)).toEqual([0, 1, 2, 0])
  })

  it('reports how far into the current beat elapsedMs is', () => {
    expect(mustBeatAt(1250, plain(120)).msIntoBeat).toBeCloseTo(250)
  })

  it('is null before bar 1 without a count-in, and before the count-in with one', () => {
    const timeline = clickTimeline({ beatGrid: grid([1, 2000]), bpm: 120, timeSignature: '4/4' })
    expect(beatAt(1999, timeline)).toBeNull()
    expect(beatAt(2000, timeline)?.isDownbeat).toBe(true)
    const withCountIn = clickTimeline({ beatGrid: grid([1, 2000]), bpm: 120, timeSignature: '4/4', countInBars: 1 })
    expect(beatAt(-1, withCountIn)).toBeNull()
    expect(beatAt(0, withCountIn)).toEqual(expect.objectContaining({ beatInBar: 0, isCountIn: true }))
    expect(beatAt(1999, withCountIn)?.isCountIn).toBe(true)
    expect(beatAt(2000, withCountIn)?.isCountIn).toBe(false)
  })

  it('counts the count-in beats 1-4 on the negative clock, never negative', () => {
    // 120 BPM 4/4 without a grid, one count-in bar: beats at -2000, -1500, -1000, -500 ms.
    expect([-2000, -1450, -1000, -499].map((ms) => beatAt(ms, plain(120, '4/4', 1))?.beatInBar)).toEqual([0, 1, 2, 3])
    expect(beatAt(-1450, plain(120, '4/4', 1))?.msIntoBeat).toBeCloseTo(50)
  })

  it('reports the tempo of the stretch playing, not the authored bpm', () => {
    // Bar 1 at 0, bar 2 at 2100 ms: 525 ms beats = 114.3 BPM although the variant says 120.
    const timeline = clickTimeline({ beatGrid: grid([1, 0], [2, 2100]), bpm: 120, timeSignature: '4/4' })
    expect(mustBeatAt(600, timeline).effectiveBpm).toBeCloseTo(114.29, 1)
    expect(mustBeatAt(600, timeline).beatInBar).toBe(1)
  })

  it('applies a live tempo nudge to a grid with a single point, not to one aligned at several bars', () => {
    const single = clickTimeline({ beatGrid: grid([1, 0]), bpm: adjustedBpm(120, 10), timeSignature: '4/4' })
    expect(mustBeatAt(0, single).effectiveBpm).toBeCloseTo(132)
    const aligned = clickTimeline({ beatGrid: grid([1, 0], [2, 2000]), bpm: adjustedBpm(120, 10), timeSignature: '4/4' })
    expect(mustBeatAt(0, aligned).effectiveBpm).toBeCloseTo(120)
  })
})

describe('countInLeadMs', () => {
  it('is 0 without a count-in, or when it fits before bar 1', () => {
    expect(countInLeadMs(plain(120))).toBe(0)
    expect(countInLeadMs(clickTimeline({ beatGrid: grid([1, 3000]), bpm: 120, timeSignature: '4/4', countInBars: 1 }))).toBe(0)
  })

  it('is the negative lead the clock must start at when the count-in does not fit', () => {
    // Bar 1 at 346 ms, 2 bars at 521.75 ms per beat: 346 - 8 x 521.75 = -3828.
    const timeline = clickTimeline({ beatGrid: grid([1, 346], [2, 2433]), bpm: 120, timeSignature: '4/4', countInBars: 2 })
    expect(countInLeadMs(timeline)).toBeCloseTo(-3828, 0)
  })
})

describe('barMsAt (#231)', () => {
  it('is beats per bar times the beat length without a grid', () => {
    expect(barMsAt(1000, plain(120))).toBe(2000)
    expect(barMsAt(1000, plain(120, '3/4'))).toBe(1500)
  })

  it('uses the stretch playing at that position', () => {
    // 400 ms beats until bar 2 at 1600, then 600 ms beats.
    const timeline = clickTimeline({ beatGrid: grid([1, 0], [2, 1600], [3, 4000]), bpm: 150, timeSignature: '4/4' })
    expect(barMsAt(800, timeline)).toBeCloseTo(1600)
    expect(barMsAt(2000, timeline)).toBeCloseTo(2400)
  })

  it('uses the first stretch during the count-in', () => {
    const timeline = clickTimeline({ beatGrid: grid([1, 1000], [2, 3100]), bpm: 120, timeSignature: '4/4', countInBars: 1 })
    expect(barMsAt(-500, timeline)).toBeCloseTo(2100)
  })
})
