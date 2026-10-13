import { describe, expect, it } from 'vitest'
import { secondsToMark } from './syncTest'

describe('sync test (docs/21 §4)', () => {
  it('marks every full second of server time once, only when far enough ahead', () => {
    expect(secondsToMark(10_200, 12_700, 10_200)).toEqual([11_000, 12_000])
    // 11 000 is only 5 ms ahead - too late to schedule reliably, skipped.
    expect(secondsToMark(10_200, 12_700, 10_995)).toEqual([12_000])
    // After the last marked second, the next window starts after it.
    expect(secondsToMark(12_000, 13_400, 12_900)).toEqual([13_000])
  })
})
