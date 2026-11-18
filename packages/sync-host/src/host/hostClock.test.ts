import { describe, expect, it } from 'vitest'
import { createHostClock, type TimeSample } from './hostClock.js'

/** A fake primary whose clock is `skew` ms ahead of ours; the answer takes `rtt` ms, symmetric. */
function fakePrimary(skew: number, ownNow: () => number) {
  return (rtt: number): TimeSample => {
    const t0 = ownNow()
    return { t0, t1: t0 + rtt, serverTime: t0 + rtt / 2 + skew }
  }
}

describe('createHostClock (#919)', () => {
  it('has no offset before the first sample, and band time is then its own clock', () => {
    const clock = createHostClock({ now: () => 1_000 })
    expect(clock.offsetMs()).toBeNull()
    expect(clock.bandTime()).toBe(1_000)
  })

  it('learns the primary\'s offset and serves band time as own clock plus that offset', () => {
    let t = 10_000
    const clock = createHostClock({ now: () => t })
    clock.add(fakePrimary(250, () => t)(4))
    expect(clock.offsetMs()).toBeCloseTo(250, 5)
    t += 500
    expect(clock.bandTime()).toBe(10_500 + 250)
  })

  it('trusts the sample with the smallest round trip (a slow answer is a worse estimate)', () => {
    let t = 0
    const clock = createHostClock({ now: () => t })
    const primary = fakePrimary(100, () => t)
    clock.add(primary(4))
    // An asymmetric, slow answer: the primary's reading is far from the midpoint.
    clock.add({ t0: 1_000, t1: 1_400, serverTime: 1_390 + 100 })
    expect(clock.offsetMs()).toBeCloseTo(100, 5)
  })

  it('forgets samples older than the window, so the offset can follow a drifting clock', () => {
    let t = 0
    const clock = createHostClock({ now: () => t, windowMs: 60_000 })
    clock.add(fakePrimary(100, () => t)(4))
    t += 61_000
    clock.add(fakePrimary(130, () => t)(10))
    expect(clock.offsetMs()).toBeCloseTo(130, 5)
  })

  it('keeps the last offset when the primary stays silent past the window - the clock must not jump back (docs/29)', () => {
    let t = 0
    const clock = createHostClock({ now: () => t, windowMs: 60_000 })
    clock.add(fakePrimary(2_500, () => t)(4))
    t += 10 * 60_000
    expect(clock.offsetMs()).toBeCloseTo(2_500, 5)
    expect(clock.bandTime()).toBe(t + 2_500)
  })

  it('ignores a sample that cannot be right (the reply before the request)', () => {
    const clock = createHostClock({ now: () => 0 })
    clock.add({ t0: 100, t1: 90, serverTime: 5 })
    expect(clock.offsetMs()).toBeNull()
  })

  it('one failed sample (null) changes nothing', () => {
    let t = 0
    const clock = createHostClock({ now: () => t })
    clock.add(fakePrimary(100, () => t)(4))
    clock.add(null)
    expect(clock.offsetMs()).toBeCloseTo(100, 5)
  })
})
