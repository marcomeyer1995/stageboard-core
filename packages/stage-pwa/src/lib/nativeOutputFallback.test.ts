import { describe, expect, it } from 'vitest'
import { FALLBACK_GRACE_MS, missingInWindowMs, shouldFallBack, trackLossEpisodes, type MissingSample } from './nativeOutputFallback'

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
})
