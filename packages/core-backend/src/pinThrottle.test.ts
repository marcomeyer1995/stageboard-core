import { describe, expect, it } from 'vitest'
import { createPinThrottle } from './pinThrottle.js'

function setup(options = {}) {
  let t = 1_000_000
  const throttle = createPinThrottle({ maxFailures: 3, lockoutMs: 60_000, now: () => t, ...options })
  return { throttle, advance: (ms: number) => (t += ms) }
}

describe('createPinThrottle', () => {
  it('is not locked before the failure limit, and the failure that reaches it triggers the lock', () => {
    const { throttle } = setup()

    expect(throttle.recordFailure('k')).toBe(false)
    expect(throttle.recordFailure('k')).toBe(false)
    expect(throttle.lockedForSeconds('k')).toBe(0)
    expect(throttle.recordFailure('k')).toBe(true)
    expect(throttle.lockedForSeconds('k')).toBe(60)
  })

  it('counts down and unlocks by itself after the dedicated time', () => {
    const { throttle, advance } = setup()
    for (let i = 0; i < 3; i++) throttle.recordFailure('k')

    advance(45_000)
    expect(throttle.lockedForSeconds('k')).toBe(15)

    advance(15_000)
    expect(throttle.lockedForSeconds('k')).toBe(0)
  })

  it('starts a clean count after a lock ends - the full budget is back, not one strike', () => {
    const { throttle, advance } = setup()
    for (let i = 0; i < 3; i++) throttle.recordFailure('k')
    advance(60_000)

    expect(throttle.recordFailure('k')).toBe(false)
    expect(throttle.recordFailure('k')).toBe(false)
    expect(throttle.lockedForSeconds('k')).toBe(0)
    expect(throttle.recordFailure('k')).toBe(true)
  })

  it('keys are independent', () => {
    const { throttle } = setup()
    for (let i = 0; i < 3; i++) throttle.recordFailure('a')

    expect(throttle.lockedForSeconds('a')).toBeGreaterThan(0)
    expect(throttle.lockedForSeconds('b')).toBe(0)
  })

  it('a correct PIN wipes the failure count', () => {
    const { throttle } = setup()
    throttle.recordFailure('k')
    throttle.recordFailure('k')
    throttle.recordSuccess('k')

    expect(throttle.recordFailure('k')).toBe(false)
    expect(throttle.recordFailure('k')).toBe(false)
    expect(throttle.lockedForSeconds('k')).toBe(0)
  })

  it('forgets scattered failures that never reached the limit once the same time has passed', () => {
    const { throttle, advance } = setup()
    throttle.recordFailure('k')
    throttle.recordFailure('k')
    advance(60_001)

    expect(throttle.recordFailure('k')).toBe(false)
    expect(throttle.recordFailure('k')).toBe(false)
    expect(throttle.lockedForSeconds('k')).toBe(0)
  })

  it('caps how many keys it tracks so probing random ids cannot grow it without limit', () => {
    const { throttle } = setup({ maxEntries: 3 })
    for (const key of ['a', 'b', 'c', 'd']) throttle.recordFailure(key)
    for (let i = 0; i < 2; i++) throttle.recordFailure('d')

    // 'd' was tracked despite the cap (oldest evicted), and still locks correctly.
    expect(throttle.lockedForSeconds('d')).toBeGreaterThan(0)
  })
})
