import { describe, expect, it } from 'vitest'
import { FALLBACK_GRACE_MS, missingInWindowMs, shouldFallBack } from './nativeOutputFallback'

const RATE = 48000
/** One status poll every 2 s, `perPoll` frames missing each time. */
function polls(from: number, count: number, perPoll: number, start = 0) {
  return Array.from({ length: count }, (_, i) => ({ at: from + i * 2000, missing: start + i * perPoll }))
}

describe('nativeOutputFallback', () => {
  it('counts the missing audio over the last 10 s only', () => {
    const samples = [...polls(0, 10, 0), ...polls(20_000, 6, 4800, 0)]
    expect(missingInWindowMs(samples, 30_000, RATE)).toBe(500)
  })

  it('a clean output never falls back', () => {
    expect(shouldFallBack(polls(0, 60, 0), 120_000, RATE, 0)).toBe(false)
  })

  it('a few lost frames do not, 20 % missing does (the phone after 17 h)', () => {
    expect(shouldFallBack(polls(20_000, 6, 480), 30_000, RATE, 0)).toBe(false)
    expect(shouldFallBack(polls(20_000, 6, 19200), 30_000, RATE, 0)).toBe(true)
  })

  it('ignores what went missing while the output was just opening', () => {
    const opening = polls(0, 7, 9600)
    expect(shouldFallBack(opening, 12_000, RATE, 0)).toBe(false)
    const after = [...opening, ...polls(FALLBACK_GRACE_MS + 1000, 3, 0, 57_600)]
    expect(shouldFallBack(after, FALLBACK_GRACE_MS + 6000, RATE, 0)).toBe(false)
  })
})
