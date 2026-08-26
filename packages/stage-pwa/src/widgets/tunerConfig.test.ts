import { describe, expect, it } from 'vitest'
import { minRmsToSlider, responsivenessFromWindow, sliderToMinRms } from './tunerConfig'

describe('sliderToMinRms / minRmsToSlider', () => {
  it('maps slider 0 to the floor and 100 to the ceiling', () => {
    expect(sliderToMinRms(0)).toBeCloseTo(0.0001, 5)
    expect(sliderToMinRms(100)).toBeCloseTo(0.05, 5)
  })

  it('round-trips a mid-range value', () => {
    const slider = minRmsToSlider(sliderToMinRms(50))
    expect(slider).toBeCloseTo(50, 5)
  })

  it('places the previously-preferred value (0.002) away from either extreme', () => {
    const slider = minRmsToSlider(0.002)
    expect(slider).toBeGreaterThan(10)
    expect(slider).toBeLessThan(90)
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
  it('reproduces the previously-preferred settings for window=5', () => {
    expect(responsivenessFromWindow(5)).toEqual({ size: 5, minReadings: 2, maxMisses: 6 })
  })

  it('never lets minReadings or maxMisses fall below 1, even for the smallest window', () => {
    expect(responsivenessFromWindow(1)).toEqual({ size: 1, minReadings: 1, maxMisses: 1 })
  })

  it('scales all three parameters up together for a larger window', () => {
    const small = responsivenessFromWindow(5)
    const large = responsivenessFromWindow(30)
    expect(large.size).toBeGreaterThan(small.size)
    expect(large.minReadings).toBeGreaterThan(small.minReadings)
    expect(large.maxMisses).toBeGreaterThan(small.maxMisses)
  })
})
