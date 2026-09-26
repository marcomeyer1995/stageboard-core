import { describe, expect, it } from 'vitest'
import { STAGE_MIN_TEXT_PX, stageFontSize } from './stageSize'

describe('stageFontSize', () => {
  it('lifts anything below the stage floor to 16px', () => {
    expect(STAGE_MIN_TEXT_PX).toBe(16)
    expect(stageFontSize(10.8)).toBe(16)
    expect(stageFontSize(0)).toBe(16)
  })

  it('leaves sizes at or above the floor unchanged, so larger ratios still scale', () => {
    expect(stageFontSize(16)).toBe(16)
    expect(stageFontSize(23.4)).toBe(23.4)
  })
})
