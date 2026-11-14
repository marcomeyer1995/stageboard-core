import { describe, expect, it } from 'vitest'
import { audible, BROKEN_JUMPS, FALLBACK_GRACE_MS, LOCK_GRACE_MS, missingInWindowMs, onBrokenStream, quietUntil, shouldFallBack, timestampJumpsInWindow, trackLossEpisodes, type MissingSample } from './nativeOutputFallback'

const RATE = 48000

/** Status polls every 2 s from `from` to `to`, with `lossAt(t)` frames missing in total by time t. */
function run(from: number, to: number, lossAt: (t: number) => number) {
  let episodes: number[] = []
  let recent: MissingSample[] = []
  const started: number[] = []
  let fellBackAt: number | null = null
  for (let now = from; now <= to; now += 2000) {
    recent = [...recent.filter((s) => s.at >= now - 10_000), { at: now, missing: lossAt(now) }]
    const tracked = trackLossEpisodes(episodes, recent, now, RATE, 0)
    episodes = tracked.episodes
    if (tracked.started) started.push(now)
    if (fellBackAt === null && shouldFallBack(episodes)) fellBackAt = now
  }
  return { started, fellBackAt }
}

describe('nativeOutputFallback', () => {
  it('counts the missing audio over the last 10 s only', () => {
    const samples = [0, 2000, 4000, 6000, 8000, 20_000, 22_000, 24_000, 26_000, 28_000, 30_000].map((at) => ({ at, missing: at >= 20_000 ? (at - 20_000) * 2.4 : 0 }))
    expect(missingInWindowMs(samples, 30_000, RATE)).toBe(500)
  })

  it('a clean output never falls back', () => {
    expect(run(0, 300_000, () => 0)).toEqual({ started: [], fellBackAt: null })
  })

  it('one stall of the whole phone (2.6 s without audio, 2026-11-06) is one loss - logged, no switch', () => {
    const result = run(0, 300_000, (t) => (t >= 60_000 ? 75_000 : 0))
    expect(result.started).toEqual([60_000])
    expect(result.fellBackAt).toBeNull()
  })

  it('audio missing again and again (the phone after 17 h, 20 %) switches after the third loss', () => {
    const result = run(0, 300_000, (t) => (t >= 30_000 ? (t - 30_000) * 9.6 : 0))
    // Seen at the first poll after it began, then once per 10-s window.
    expect(result.started.slice(0, 3)).toEqual([32_000, 42_000, 52_000])
    expect(result.fellBackAt).toBe(52_000)
  })

  it('three single stalls spread over more than 2 minutes do not add up', () => {
    const result = run(0, 400_000, (t) => (t >= 30_000 ? 20_000 : 0) + (t >= 120_000 ? 20_000 : 0) + (t >= 210_000 ? 20_000 : 0))
    expect(result.started).toEqual([30_000, 120_000, 210_000])
    expect(result.fellBackAt).toBeNull()
  })

  it('ignores what went missing while the output was just opening', () => {
    const result = run(0, 60_000, (t) => (t <= 12_000 ? t * 4.8 : 57_600))
    expect(result.started).toEqual([])
    expect(FALLBACK_GRACE_MS).toBe(15_000)
  })

  it('a locked screen does not count - hidden, and 5 s after unlocking', () => {
    expect(quietUntil(true, 1000)).toBe(Number.POSITIVE_INFINITY)
    expect(quietUntil(false, 1000)).toBe(1000 + LOCK_GRACE_MS)
  })

  it('a gap in silence does not count - the Fire idle for 5 h, 18 s missing at 06:26 (2026-11-07)', () => {
    expect(audible(null, 1000)).toBe(false)
    expect(audible(10_000, 20_000)).toBe(true)
    expect(audible(10_000, 26_000)).toBe(false)
  })
})

describe('broken stream (#837)', () => {
  it('counts timestamp jumps over the last 10 s only', () => {
    const samples = [
      { at: 0, timestampJumps: 1 },
      { at: 4000, timestampJumps: 1 },
      { at: 8000, timestampJumps: 3 },
      { at: 12_000, timestampJumps: 5 },
    ]
    expect(timestampJumpsInWindow(samples, 12_000)).toBe(4) // 4000 → 12000
    expect(timestampJumpsInWindow(samples.slice(0, 2), 4000)).toBe(0)
    expect(timestampJumpsInWindow(samples, 12_000) >= BROKEN_JUMPS).toBe(true)
  })

  it('opens the stream again the first time, falls back if it breaks again within 2 min', () => {
    expect(onBrokenStream(null, 100_000)).toBe('reopen')
    expect(onBrokenStream(100_000, 160_000)).toBe('fall-back')
    expect(onBrokenStream(100_000, 100_000 + 121_000)).toBe('reopen')
  })
})
