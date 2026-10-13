import { beforeEach, describe, expect, it } from 'vitest'
import { getCueTimingStats, recordHandover, recordStall, recordTick, recordWatched, resetCueTimingStats } from './cueTimingStats'

describe('cue timing statistics (#477)', () => {
  beforeEach(() => resetCueTimingStats())

  it('sorts tick gaps into buckets and keeps the longest', () => {
    for (const gap of [25, 26, 60, 140, 400]) recordTick(gap)
    const stats = getCueTimingStats()
    expect(stats.ticks).toBe(5)
    // ≤30, ≤50, ≤75, ≤100, ≤150, ≤250, above
    expect(stats.tickGapBuckets).toEqual([2, 0, 1, 0, 1, 0, 1])
    expect(stats.tickGapMaxMs).toBe(400)
  })

  it('counts cues handed over after their send moment as late', () => {
    recordHandover(-80)
    recordHandover(0)
    recordHandover(12)
    recordHandover(40)
    expect(getCueTimingStats()).toMatchObject({ cuesHandedOver: 4, lateHandovers: 2, lateMaxMs: 40 })
  })

  it('is readable over USB as window.__sbCueScheduler, also after a reset', () => {
    recordTick(30)
    resetCueTimingStats()
    expect((window as unknown as { __sbCueScheduler: unknown }).__sbCueScheduler).toBe(getCueTimingStats())
    expect(getCueTimingStats().ticks).toBe(0)
  })

  it('sorts main-thread stalls into buckets and adds up the watched playing time', () => {
    for (const d of [55, 120, 180, 420]) recordStall(d)
    recordWatched(60_000)
    const stats = getCueTimingStats()
    // ≤75, ≤100, ≤125, ≤150, ≤200, ≤300, above
    expect(stats.stallBuckets).toEqual([1, 0, 1, 0, 1, 0, 1])
    expect(stats).toMatchObject({ stallMaxMs: 420, watchedMs: 60_000 })
  })
})
