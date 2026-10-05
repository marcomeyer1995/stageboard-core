import { describe, expect, it } from 'vitest'
import { stageVariantLabel } from './variantLabel'

describe('stageVariantLabel', () => {
  it('shortens auto-detected variant names to "Auto"', () => {
    expect(stageVariantLabel('Auto: music-tempo (Beatroot, MIT)')).toBe('Auto')
    expect(stageVariantLabel('Auto: Hand-rolled (FFT/Spectral-Flux)')).toBe('Auto')
  })

  it('keeps every other name as it is', () => {
    expect(stageVariantLabel('Akustik')).toBe('Akustik')
    expect(stageVariantLabel('Automatisch gespielt')).toBe('Automatisch gespielt')
  })
})
