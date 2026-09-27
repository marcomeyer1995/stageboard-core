import { describe, expect, it } from 'vitest'
import { fitTempoMap, mergeTappedAnchors, playbackAnchors } from './tempoMap'

/** Deterministic noise in [-1, 1] - repeatable tests without Math.random. */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return 2 * (x - Math.floor(x)) - 1
}

/** True beat times of a song whose tempo drifts linearly from `fromBpm` to `toBpm`. */
function trueBeats(count: number, fromBpm: number, toBpm = fromBpm, startMs = 1000): number[] {
  const times = [startMs]
  for (let i = 1; i < count; i++) {
    const bpm = fromBpm + ((toBpm - fromBpm) * i) / count
    times.push(times[i - 1]! + 60000 / bpm)
  }
  return times
}

const jitterMs = (times: number[]) => {
  const d2 = times.slice(2).map((t, i) => t - 2 * times[i + 1]! + times[i]!)
  return Math.sqrt(d2.reduce((s, x) => s + x * x, 0) / d2.length)
}

describe('fitTempoMap', () => {
  it('removes per-beat tap noise but stays on the true beats', () => {
    // Measured on the band's tracks: tapped/detected anchors scatter ±20-30 ms around the beat.
    const truth = trueBeats(200, 114)
    const anchors = truth.map((t, i) => ({ timeMs: t + 25 * noise(i), beatInBar: i % 4 }))
    const map = fitTempoMap(anchors, 114, '4/4')
    const fitted = map.beats.map((b) => b.timeMs)
    expect(fitted).toHaveLength(200)
    expect(jitterMs(anchors.map((a) => a.timeMs))).toBeGreaterThan(20)
    expect(jitterMs(fitted)).toBeLessThan(3)
    const maxError = Math.max(...fitted.map((t, i) => Math.abs(t - truth[i]!)))
    expect(maxError).toBeLessThan(15)
    expect(map.quality?.verdict).toBe('good')
  })

  it('follows a slow tempo drift (1-3 % within a song on the measured tracks)', () => {
    const truth = trueBeats(300, 112, 116)
    const map = fitTempoMap(truth.map((t, i) => ({ timeMs: t + 20 * noise(i), beatInBar: i % 4 })), 114, '4/4')
    const fitted = map.beats.map((b) => b.timeMs)
    expect(Math.max(...fitted.map((t, i) => Math.abs(t - truth[i]!)))).toBeLessThan(15)
    expect(map.quality?.bpmLow).toBeLessThan(113)
    expect(map.quality?.bpmHigh).toBeGreaterThan(115)
  })

  it('drops double anchors (Highway to Hell: 86 anchors 120-200 ms after the real beat)', () => {
    const truth = trueBeats(64, 116)
    const anchors = truth.flatMap((t, i) => [{ timeMs: t, beatInBar: i % 4 }, ...(i % 3 === 0 ? [{ timeMs: t + 150 + 40 * noise(i), beatInBar: (i + 1) % 4 }] : [])])
    const map = fitTempoMap(anchors, 116, '4/4')
    expect(map.beats).toHaveLength(64)
    expect(map.quality?.duplicates).toBe(22)
    expect(Math.max(...map.beats.map((b, i) => Math.abs(b.timeMs - truth[i]!)))).toBeLessThan(10)
  })

  it('counts beats between sparse anchors with the real tempo, not a wrong nominal bpm', () => {
    // What's Up (Auto): anchors every ~4 beats, nominal 127.6 BPM, really ~134.
    const truth = trueBeats(129, 134)
    const anchors = truth.filter((_, i) => i % 4 === 0).map((t) => ({ timeMs: t }))
    const map = fitTempoMap(anchors, 127.6, '4/4')
    expect(map.beats).toHaveLength(129)
    expect(Math.max(...map.beats.map((b, i) => Math.abs(b.timeMs - truth[i]!)))).toBeLessThan(5)
    expect(map.quality?.nominalOffPercent).toBeCloseTo(-4.8, 0)
  })

  it('never runs backwards at a messy song start (What\'s Up: two anchors 0.6 beats apart)', () => {
    const truth = trueBeats(60, 136, 136, 3000)
    const anchors = [{ timeMs: 3263 }, ...truth.map((t) => ({ timeMs: t }))].sort((a, b) => a.timeMs - b.timeMs)
    const beats = fitTempoMap(anchors, 127.5, '4/4').beats.map((b) => b.timeMs)
    beats.slice(1).forEach((t, i) => expect(t - beats[i]!).toBeGreaterThan(200))
  })

  it('ignores a stray tap far off the beat', () => {
    const truth = trueBeats(80, 120)
    const anchors = truth.map((t, i) => ({ timeMs: i === 40 ? t + 180 : t, beatInBar: i % 4 }))
    const map = fitTempoMap(anchors, 120, '4/4')
    expect(Math.abs(map.beats[40]!.timeMs - truth[40]!)).toBeLessThan(10)
    expect(map.quality?.outliers).toBe(1)
  })

  it('takes the downbeat from the majority of stored beat numbers', () => {
    const truth = trueBeats(40, 120)
    // Beat 1 is the second anchor; five anchors carry a wrong beat number.
    const anchors = truth.map((t, i) => ({ timeMs: t, beatInBar: i % 7 === 3 ? 0 : (i + 3) % 4 }))
    const map = fitTempoMap(anchors, 120, '4/4')
    expect(map.beats.slice(0, 5).map((b) => b.beatInBar)).toEqual([3, 0, 1, 2, 3])
    expect(map.quality?.beatInBarConflicts).toBeGreaterThan(0)
    expect(map.quality?.verdict).not.toBe('good')
  })

  it('fits each tempo-marker section on its own', () => {
    const first = trueBeats(32, 100)
    const markerMs = first[31]! + 600
    const second = trueBeats(32, 140, 140, markerMs)
    const anchors = [...first, ...second].map((t) => ({ timeMs: t }))
    const map = fitTempoMap(anchors, 100, '4/4', [{ timeMs: markerMs, bpm: 140 }])
    expect(map.beats).toHaveLength(64)
    expect(Math.abs(map.beats[32]!.timeMs - markerMs)).toBeLessThan(5)
  })

  it('plays too few anchors as they are', () => {
    const anchors = [{ timeMs: 460, beatInBar: 0 }, { timeMs: 940 }]
    expect(fitTempoMap(anchors, 114, '4/4')).toEqual({ beats: anchors, quality: null })
  })
})

describe('playbackAnchors', () => {
  it('caches the fit per anchors array', () => {
    const variant = { beatAnchors: trueBeats(20, 120).map((t) => ({ timeMs: t })), bpm: 120, timeSignature: '4/4' }
    expect(playbackAnchors(variant)).toBe(playbackAnchors({ ...variant }))
    expect(playbackAnchors(null)).toEqual([])
  })
})

describe('mergeTappedAnchors', () => {
  it('replaces the anchors in the tapped stretch instead of adding a second set', () => {
    const existing = [0, 500, 1000, 1500, 2000, 2500, 3000].map((timeMs) => ({ timeMs }))
    const tapped = [1010, 1490, 2020].map((timeMs) => ({ timeMs }))
    // 120 BPM: half a beat = 250 ms of margin around 1010-2020.
    expect(mergeTappedAnchors(existing, tapped, 120).map((a) => a.timeMs)).toEqual([0, 500, 1010, 1490, 2020, 2500, 3000])
  })

  it('keeps everything when nothing was tapped', () => {
    const existing = [{ timeMs: 100 }]
    expect(mergeTappedAnchors(existing, [], 120)).toEqual(existing)
  })
})
