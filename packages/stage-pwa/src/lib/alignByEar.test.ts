import { describe, expect, it } from 'vitest'
import { alignmentBeatsDue, bracketMiddle, clampAlignValue, isAlignAccent, median, pairOffsets } from './alignByEar'

describe('Abgleich nach Gehör (docs/21 §4)', () => {
  it('lists the session beats after one point up to another, never before the first', () => {
    expect(alignmentBeatsDue(10_000, 600, 0, 11_300)).toEqual([10_000, 10_600, 11_200])
    expect(alignmentBeatsDue(10_000, 600, 10_600, 11_800)).toEqual([11_200, 11_800])
    expect(alignmentBeatsDue(10_000, 600, 10_601, 10_700)).toEqual([])
  })

  it('takes the middle of the two edges where the flam was just audible', () => {
    expect(bracketMiddle(-8, 22)).toBe(7)
    expect(bracketMiddle(30, 15)).toBe(23)
  })
})

describe('Abgleich: Takt, Bereich, Mikrofon', () => {
  it('accents the first beat of every bar of four', () => {
    expect([0, 1, 2, 3, 4, 8].map((k) => isAlignAccent(1_000, 600, 1_000 + k * 600))).toEqual([true, false, false, false, true, true])
  })

  it('keeps the value within 250 ms of where it started', () => {
    expect(clampAlignValue(400, 100)).toBe(350)
    expect(clampAlignValue(-200, 100)).toBe(-150)
    expect(clampAlignValue(120, 100)).toBe(120)
  })

  it('pairs each target click with the nearest reference click, leaves strays out', () => {
    const ref = [1.0, 1.6, 2.2]
    const target = [1.012, 1.595, 2.5]
    expect(pairOffsets(ref, target).map((v) => Math.round(v))).toEqual([12, -5])
    expect(median([12, -5, 3])).toBe(3)
    expect(median([])).toBeNull()
  })
})
