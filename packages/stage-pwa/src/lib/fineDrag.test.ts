import { describe, expect, it } from 'vitest'
import { FINE_DEAD_ZONE_PX, fineFactor, fineRatioLabel, fineStep } from './fineDrag'

describe('fine drag (#334)', () => {
  it('counts full inside the dead zone, then finer the further away (up or down)', () => {
    expect(fineFactor(0)).toBe(1)
    expect(fineFactor(FINE_DEAD_ZONE_PX)).toBe(1)
    expect(fineFactor(-FINE_DEAD_ZONE_PX)).toBe(1)
    expect(fineFactor(FINE_DEAD_ZONE_PX + 100)).toBeCloseTo(1 / 6)
    expect(fineFactor(-(FINE_DEAD_ZONE_PX + 200))).toBeCloseTo(1 / 11)
  })

  it('scales each step on its own, so changing the distance never jumps', () => {
    let x = 100
    x = fineStep(x, 100, 160, 1) // 60 px at full speed
    expect(x).toBe(160)
    x = fineStep(x, 160, 160, 1 / 6) // finger moved down only: nothing moves
    expect(x).toBe(160)
    x = fineStep(x, 160, 220, 1 / 6) // 60 px in fine mode count as 10
    expect(x).toBeCloseTo(170)
  })

  it('labels the ratio', () => {
    expect(fineRatioLabel(1 / 6)).toBe('1:6')
    expect(fineRatioLabel(fineFactor(FINE_DEAD_ZONE_PX + 30))).toBe('1:3')
  })
})
