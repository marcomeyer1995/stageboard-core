import { describe, expect, it } from 'vitest'
import type { BeatGrid } from 'shared-types'
import { trackBeats } from './beatTrack'
import { refineGrid } from './gridRefine'

/** A band that speeds up: 120 BPM for 12 bars, then 126 - drums on every beat, guitar/bass on
 * every eighth in between (onsets too, the reason a single bar could land on the offbeat). */
function song(): { beats: number[]; onsets: number[] } {
  const beats: number[] = []
  for (let i = 0, t = 1000; i < 160; i++) {
    beats.push(Math.round(t))
    t += i < 48 ? 500 : 60000 / 126
  }
  const eighths = beats.slice(0, -1).map((b, i) => Math.round((b + beats[i + 1]!) / 2))
  return { beats, onsets: [...beats, ...eighths].sort((a, b) => a - b) }
}

describe('trackBeats (beat tracking by dynamic programming)', () => {
  it('follows a tempo change and stays on the beat, eighths in between notwithstanding', () => {
    const { beats, onsets } = song()
    const tracked = trackBeats(onsets, 1000, 500, beats[beats.length - 1]!)
    expect(tracked.length).toBe(beats.length)
    tracked.forEach((t, i) => expect(Math.abs(t - beats[i]!)).toBeLessThanOrEqual(1))
  })
})

describe('refineGrid ("Track analysieren" on an existing grid, 2026-10-15)', () => {
  it('keeps the own point and adds few points, apart from each other, until the bars fit', () => {
    const { beats, onsets } = song()
    const own: BeatGrid = { points: [{ id: 'mine', bar: 1, timeMs: 1000 }], meters: [] }
    const result = refineGrid(own, 120, '4/4', onsets)!
    expect(result.grid.points[0]).toEqual({ id: 'mine', bar: 1, timeMs: 1000 })
    expect(result.addedBars.length).toBeGreaterThan(0)
    expect(result.addedBars.length).toBeLessThanOrEqual(4)
    const bars = result.grid.points.map((p) => p.bar)
    bars.slice(1).forEach((b, i) => expect(b - bars[i]!).toBeGreaterThanOrEqual(6))
    expect(result.poorAfter).toBeLessThan(result.poorBefore)
    expect(result.poorAfter).toBe(0)
    // Every point sits on its real downbeat.
    for (const p of result.grid.points) expect(Math.abs(p.timeMs - beats[(p.bar - 1) * 4]!)).toBeLessThanOrEqual(5)
  })

  it('a point the tracked beat agrees with stays exactly; one clearly off is moved and reported', () => {
    const { beats, onsets } = song()
    const bar30 = beats[29 * 4]!
    const close = refineGrid({ points: [{ id: 'a', bar: 1, timeMs: 1000 }, { id: 'b', bar: 30, timeMs: bar30 + 20 }], meters: [] }, 120, '4/4', onsets)!
    expect(close.grid.points.find((p) => p.id === 'b')!.timeMs).toBe(bar30 + 20)
    expect(close.movedBars).toEqual([])
    const off = refineGrid({ points: [{ id: 'a', bar: 1, timeMs: 1000 }, { id: 'b', bar: 30, timeMs: bar30 + 240 }], meters: [] }, 120, '4/4', onsets)!
    expect(off.movedBars).toEqual([30])
    expect(Math.abs(off.grid.points.find((p) => p.id === 'b')!.timeMs - bar30)).toBeLessThanOrEqual(5)
  })

  it('nothing to do on a grid that already fits', () => {
    const onsets = Array.from({ length: 64 }, (_, i) => 1000 + i * 500)
    const result = refineGrid({ points: [{ id: 'a', bar: 1, timeMs: 1000 }], meters: [] }, 120, '4/4', onsets)!
    expect(result.addedBars).toEqual([])
    expect(result.movedBars).toEqual([])
  })
})
