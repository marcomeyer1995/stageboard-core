import { describe, expect, it } from 'vitest'
import { centsToColor } from './centsColor'

describe('centsToColor', () => {
  it('is pure green when exactly in tune', () => {
    expect(centsToColor(0)).toBe('hsl(120, 85%, 50%)')
  })

  it('is pure red at the extreme (+/-50 cents)', () => {
    expect(centsToColor(50)).toBe('hsl(0, 85%, 50%)')
    expect(centsToColor(-50)).toBe('hsl(0, 85%, 50%)')
  })

  it('treats a sharp and a flat deviation of the same magnitude identically', () => {
    expect(centsToColor(25)).toBe(centsToColor(-25))
  })

  it('clamps beyond +/-50 cents to the same red as exactly 50', () => {
    expect(centsToColor(80)).toBe(centsToColor(50))
    expect(centsToColor(-80)).toBe(centsToColor(50))
  })

  it('is roughly yellow halfway between in-tune and the extreme', () => {
    expect(centsToColor(25)).toBe('hsl(60, 85%, 50%)')
  })
})
