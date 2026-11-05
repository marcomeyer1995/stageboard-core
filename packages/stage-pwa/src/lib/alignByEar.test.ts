import { describe, expect, it } from 'vitest'
import { alignmentBeatsDue, bracketMiddle } from './alignByEar'

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
