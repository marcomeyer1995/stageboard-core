import { describe, expect, it } from 'vitest'
import { centsToColor } from './centsColor'

describe('centsToColor', () => {
  it('is strictly green within +/-2 cents', () => {
    expect(centsToColor(0)).toBe('hsl(120, 85%, 50%)')
    expect(centsToColor(2)).toBe('hsl(120, 85%, 50%)')
    expect(centsToColor(-2)).toBe('hsl(120, 85%, 50%)')
  })

  it('jumps to orange, not yellow, just past the green threshold', () => {
    const hue = Number(centsToColor(2.01).match(/hsl\((\d+(?:\.\d+)?)/)?.[1])
    expect(hue).toBeCloseTo(30, 0)
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

  it('degrades monotonically from orange to red as the deviation grows', () => {
    const near = centsToColor(5)
    const mid = centsToColor(25)
    const far = centsToColor(45)
    const hueOf = (hsl: string) => Number(hsl.match(/hsl\((\d+(?:\.\d+)?)/)?.[1])
    expect(hueOf(near)).toBeGreaterThan(hueOf(mid))
    expect(hueOf(mid)).toBeGreaterThan(hueOf(far))
  })
})
