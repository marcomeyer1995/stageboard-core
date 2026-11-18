import { describe, expect, it } from 'vitest'
import { createHostClock } from './hostClock'

describe('band time after a takeover (#947)', () => {
  it('keeps the primary\'s offset from the sample with the smallest round trip', () => {
    const now = 1_000_000
    const clock = createHostClock({ now: () => now })
    clock.add({ t0: now, t1: now + 20, serverTime: now + 1_000 })
    clock.add({ t0: now, t1: now + 2, serverTime: now + 505 })
    expect(clock.offsetMs()).toBe(504)
    expect(clock.bandTime()).toBe(now + 504)
  })

  it('keeps the last offset when the primary goes silent', () => {
    let now = 1_000_000
    const clock = createHostClock({ now: () => now, windowMs: 10_000 })
    clock.add({ t0: now, t1: now + 2, serverTime: now + 500 })
    now += 30_000
    expect(clock.offsetMs()).toBe(499)
    expect(clock.bandTime()).toBe(now + 499)
  })

  it('is just the own clock before any sample', () => {
    const clock = createHostClock({ now: () => 42 })
    expect(clock.offsetMs()).toBeNull()
    expect(clock.bandTime()).toBe(42)
  })

  it('ignores a broken sample', () => {
    const clock = createHostClock({ now: () => 100 })
    clock.add({ t0: 200, t1: 100, serverTime: 1 })
    clock.add(null)
    expect(clock.offsetMs()).toBeNull()
  })
})
