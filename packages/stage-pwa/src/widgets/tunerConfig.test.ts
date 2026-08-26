import { describe, expect, it } from 'vitest'
import { minRmsToSlider, responsivenessFromWindow, sliderToMinRms } from './tunerConfig'

describe('sliderToMinRms / minRmsToSlider', () => {
  it('maps slider 0 to the floor and 100 to the ceiling', () => {
    expect(sliderToMinRms(0)).toBeCloseTo(0.00005, 6)
    expect(sliderToMinRms(100)).toBeCloseTo(0.007, 6)
  })

  it('round-trips a mid-range value', () => {
    const slider = minRmsToSlider(sliderToMinRms(50))
    expect(slider).toBeCloseTo(50, 5)
  })

  it('places the current default (0.0006) at the middle of the slider', () => {
    expect(minRmsToSlider(0.0006)).toBeCloseTo(50, 0)
  })

  it('is monotonically increasing', () => {
    expect(sliderToMinRms(10)).toBeLessThan(sliderToMinRms(50))
    expect(sliderToMinRms(50)).toBeLessThan(sliderToMinRms(90))
  })

  it('clamps out-of-range slider input', () => {
    expect(sliderToMinRms(-10)).toBeCloseTo(sliderToMinRms(0), 10)
    expect(sliderToMinRms(150)).toBeCloseTo(sliderToMinRms(100), 10)
  })
})

describe('responsivenessFromWindow', () => {
  it('reproduces the current default settings for window=60', () => {
    expect(responsivenessFromWindow(60)).toEqual({ size: 60, minReadings: 24, maxMisses: 72 })
  })

  it('never lets minReadings or maxMisses fall below 1, even for the smallest window', () => {
    expect(responsivenessFromWindow(1)).toEqual({ size: 1, minReadings: 1, maxMisses: 1 })
  })

  it('scales all three parameters up together for a larger window', () => {
    const small = responsivenessFromWindow(10)
    const large = responsivenessFromWindow(100)
    expect(large.size).toBeGreaterThan(small.size)
    expect(large.minReadings).toBeGreaterThan(small.minReadings)
    expect(large.maxMisses).toBeGreaterThan(small.maxMisses)
  })
})
