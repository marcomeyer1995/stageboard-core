import { describe, expect, it } from 'vitest'
import type { ShowCue } from 'shared-types'
import { parseShiftSeconds, rippleShift } from './rippleShift'
import { timelineLines } from './timelineText'

const content = ['{part: Verse}', '[00:01.00]First line', '[00:05.00]Second line', '[00:09.00]Third line'].join('\n')
const grid = {
  points: [
    { id: 'p1', bar: 1, timeMs: 500 },
    { id: 'p5', bar: 5, timeMs: 8500 },
  ],
  meters: [],
}
const cue = (id: string, timeMs: number) => ({ id, timeMs }) as unknown as ShowCue
const input = { beatGrid: grid, chordProContent: content, cues: [cue('a', 2000), cue('b', 6000)] }
const times = (text: string) => timelineLines(text).map((l) => l.timeMs)

describe('rippleShift (#330)', () => {
  it('a bar line between points (fractional time) becomes a point and moves along (Marco, 2026-10-05)', () => {
    // Bar 3 halfway between the points at a fractional time - rounded down it used to land just
    // before the threshold and stay behind.
    const r = rippleShift(input, 4500.4, 1000, { bar: 3, timeMs: 4500.4 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.beatGrid!.points.map((p) => [p.bar, p.timeMs])).toEqual([
      [1, 500],
      [3, 5500],
      [5, 9500],
    ])
  })

  it('moves the whole song by +2 s from 0:00 - grid, lines and cues, distances intact', () => {
    const r = rippleShift(input, 0, 2000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.beatGrid!.points.map((p) => p.timeMs)).toEqual([2500, 10500])
    expect(times(r.chordProContent)).toEqual([3000, 7000, 11000])
    expect(r.cues.map((c) => c.timeMs)).toEqual([4000, 8000])
    expect(r.moved).toEqual({ points: 2, lines: 3, cues: 2 })
  })

  it('moves only what is at or after the chosen point', () => {
    const r = rippleShift(input, 5000, 1000)
    expect(r.ok && times(r.chordProContent)).toEqual([1000, 6000, 10000])
    expect(r.ok && r.beatGrid!.points.map((p) => p.timeMs)).toEqual([500, 9500])
    expect(r.ok && r.cues.map((c) => c.timeMs)).toEqual([2000, 7000])
  })

  it('turns a selected bar that is not a point yet into one, so it moves along', () => {
    const r = rippleShift(input, 4500, 1000, { bar: 3, timeMs: 4500 })
    expect(r.ok && r.beatGrid!.points.map((p) => [p.bar, p.timeMs])).toEqual([
      [1, 500],
      [3, 5500],
      [5, 9500],
    ])
  })

  it('refuses to move anything before 0:00', () => {
    const r = rippleShift(input, 0, -600)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toContain('vor 0:00')
  })

  it('refuses to overtake an earlier line or point that stays', () => {
    expect(rippleShift(input, 5000, -4500).ok).toBe(false)
    expect(rippleShift(input, 8000, -8100).ok).toBe(false)
  })

  it('parses seconds with comma or dot and a sign', () => {
    expect(parseShiftSeconds('2')).toBe(2000)
    expect(parseShiftSeconds('-1,5')).toBe(-1500)
    expect(parseShiftSeconds('+0.25 s')).toBe(250)
    expect(parseShiftSeconds('abc')).toBeNull()
  })
})
