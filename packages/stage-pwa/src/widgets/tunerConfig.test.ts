import { describe, expect, it } from 'vitest'
import { minRmsToSlider, responsivenessFromWindow, sliderToMinRms } from './tunerConfig'

describe('sliderToMinRms / minRmsToSlider', () => {
  it('is inverted: slider 0 (Unempfindlich) is the ceiling, slider 100 (Empfindlich) is the floor', () => {
    expect(sliderToMinRms(0)).toBeCloseTo(0.1, 6)
    expect(sliderToMinRms(100)).toBeCloseTo(0.0005, 6)
  })

  it('a higher slider value means a lower (more sensitive) minRms', () => {
    expect(sliderToMinRms(80)).toBeLessThan(sliderToMinRms(20))
  })

  it('round-trips a mid-range value', () => {
    const slider = minRmsToSlider(sliderToMinRms(50))
    expect(slider).toBeCloseTo(50, 5)
  })

  it('places the current default (0.007) at the middle of the slider', () => {
    expect(minRmsToSlider(0.007)).toBeCloseTo(50, 0)
  })

  it('is monotonically decreasing in minRms as the slider increases', () => {
    expect(sliderToMinRms(10)).toBeGreaterThan(sliderToMinRms(50))
    expect(sliderToMinRms(50)).toBeGreaterThan(sliderToMinRms(90))
  })

  it('clamps out-of-range slider input', () => {
    expect(sliderToMinRms(-10)).toBeCloseTo(sliderToMinRms(0), 10)
    expect(sliderToMinRms(150)).toBeCloseTo(sliderToMinRms(100), 10)
  })
})

describe('responsivenessFromWindow', () => {
  it('reproduces the current default settings for window=100', () => {
    expect(responsivenessFromWindow(100)).toEqual({ size: 100, minReadings: 40, maxMisses: 120 })
  })

  it('never lets minReadings or maxMisses fall below 1, even for a small window', () => {
    expect(responsivenessFromWindow(1)).toEqual({ size: 1, minReadings: 1, maxMisses: 1 })
  })

  it('scales all three parameters up together for a larger window', () => {
    const small = responsivenessFromWindow(50)
    const large = responsivenessFromWindow(150)
    expect(large.size).toBeGreaterThan(small.size)
    expect(large.minReadings).toBeGreaterThan(small.minReadings)
    expect(large.maxMisses).toBeGreaterThan(small.maxMisses)
  })
})
