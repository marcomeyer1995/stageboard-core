import { describe, expect, it } from 'vitest'
import { clampRate, passRates, passStartSec, positionAt } from './loopSchedule'

describe('passRates', () => {
  it('climbs from start to target in steps, ending exactly on the target', () => {
    expect(passRates({ startRate: 0.8, targetRate: 1, step: 0.05 })).toEqual([0.8, 0.85, 0.9, 0.95, 1])
    expect(passRates({ startRate: 0.7, targetRate: 1, step: 0.1 })).toEqual([0.7, 0.8, 0.9, 1])
  })

  it('caps the last step at the target instead of overshooting', () => {
    expect(passRates({ startRate: 0.8, targetRate: 1, step: 0.15 })).toEqual([0.8, 0.95, 1])
  })

  it('stays fixed with no step or when already at/above the target', () => {
    expect(passRates({ startRate: 0.8, targetRate: 1, step: 0 })).toEqual([0.8])
    expect(passRates({ startRate: 1, targetRate: 1, step: 0.05 })).toEqual([1])
    expect(passRates({ startRate: 1.1, targetRate: 1, step: 0.05 })).toEqual([1.1])
  })
})

describe('positionAt', () => {
  const LENGTH_MS = 10_000

  it('is at the loop start when it begins, and never before it', () => {
    expect(positionAt([1], LENGTH_MS, 0)).toEqual({ pass: 0, rate: 1, offsetMs: 0 })
    expect(positionAt([1], LENGTH_MS, -1)).toEqual({ pass: 0, rate: 1, offsetMs: 0 })
  })

  it('advances at the pass rate and wraps at the loop end', () => {
    expect(positionAt([1], LENGTH_MS, 4).offsetMs).toBeCloseTo(4000)
    const wrapped = positionAt([1], LENGTH_MS, 13)
    expect(wrapped.pass).toBe(1)
    expect(wrapped.offsetMs).toBeCloseTo(3000)
  })

  it('takes longer per pass at a lower rate', () => {
    // 50 %: a 10 s loop needs 20 s of wall time.
    const halfway = positionAt([0.5], LENGTH_MS, 10)
    expect(halfway.offsetMs).toBeCloseTo(5000)
    expect(positionAt([0.5], LENGTH_MS, 20).pass).toBe(1)
  })

  it('moves to the next rate exactly when the previous pass completes', () => {
    const rates = [0.5, 1]
    // Pass 0 takes 20 s of wall time.
    expect(positionAt(rates, LENGTH_MS, 19.9)).toMatchObject({ pass: 0, rate: 0.5 })
    const next = positionAt(rates, LENGTH_MS, 25)
    expect(next.pass).toBe(1)
    expect(next.rate).toBe(1)
    expect(next.offsetMs).toBeCloseTo(5000)
  })

  it('keeps counting passes at the final rate', () => {
    const rates = [0.5, 1]
    // 20 s (pass 0) + 10 s (pass 1) + 10 s (pass 2) + 2 s into pass 3.
    const late = positionAt(rates, LENGTH_MS, 42)
    expect(late.pass).toBe(3)
    expect(late.offsetMs).toBeCloseTo(2000)
  })
})

describe('passStartSec', () => {
  it('sums the wall time of the preceding passes', () => {
    const rates = [0.5, 1]
    expect(passStartSec(rates, 10_000, 0)).toBe(0)
    expect(passStartSec(rates, 10_000, 1)).toBe(20)
    expect(passStartSec(rates, 10_000, 2)).toBe(30)
  })
})

describe('clampRate', () => {
  it('keeps the rate inside the supported range', () => {
    expect(clampRate(0.01)).toBe(0.25)
    expect(clampRate(9)).toBe(1.5)
    expect(clampRate(0.9)).toBe(0.9)
  })
})
