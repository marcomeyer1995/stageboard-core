import { describe, expect, it } from 'vitest'
import { diffCapabilities, finalizeSongPlay, shouldConfirmSong, shouldStartNewShow } from './showLogTracking'

describe('shouldConfirmSong', () => {
  it('confirms an active duration at least the minimum threshold', () => {
    expect(shouldConfirmSong(20_000, 20_000)).toBe(true)
    expect(shouldConfirmSong(30_000, 20_000)).toBe(true)
  })

  it('discards an active duration under the minimum threshold - a corrected wrong tap', () => {
    expect(shouldConfirmSong(5_000, 20_000)).toBe(false)
  })
})

describe('shouldStartNewShow', () => {
  it('starts a new show when there has never been one', () => {
    expect(shouldStartNewShow(null, Date.now())).toBe(true)
  })

  it('continues the current show within the gap threshold', () => {
    const now = 1_000_000
    expect(shouldStartNewShow(now - 10 * 60_000, now, 45 * 60_000)).toBe(false)
  })

  it('starts a new show once the gap threshold has passed', () => {
    const now = 1_000_000
    expect(shouldStartNewShow(now - 46 * 60_000, now, 45 * 60_000)).toBe(true)
  })
})

describe('finalizeSongPlay', () => {
  const entry = { songId: 'a', songTitle: 'A' }

  it('logs a play-through whose active time met the threshold', () => {
    const result = finalizeSongPlay(entry, 1000, 25_000, 1000 + 90_000, 'show-1')
    expect(result).toEqual({ showId: 'show-1', songId: 'a', songTitle: 'A', at: 1000, endedAt: 91_000, activeMs: 25_000 })
  })

  it('discards a play-through whose active time never met the threshold - e.g. Stop right after Play', () => {
    expect(finalizeSongPlay(entry, 1000, 4_000, 1000 + 4_000, 'show-1')).toBeNull()
  })

  it('excludes paused time from the logged duration even when the wall-clock span is long (#13)', () => {
    // 90s wall-clock span, but only 25s of it was actually active (playbackAccumulatedMs) -
    // e.g. a long stage-banter pause in between.
    const result = finalizeSongPlay(entry, 1000, 25_000, 1000 + 90_000, 'show-1')
    expect(result?.activeMs).toBe(25_000)
    expect(result?.endedAt - (result?.at ?? 0)).toBe(90_000)
  })
})

describe('diffCapabilities', () => {
  it('detects a capability going from available to degraded', () => {
    const previous = new Map([['mixer', 'available' as const]])
    const current = new Map([['mixer', 'degraded' as const]])
    expect(diffCapabilities(previous, current)).toEqual([
      { capability: 'mixer', from: 'available', to: 'degraded' },
    ])
  })

  it('returns nothing when no status changed', () => {
    const previous = new Map([['mixer', 'available' as const]])
    const current = new Map([['mixer', 'available' as const]])
    expect(diffCapabilities(previous, current)).toEqual([])
  })

  it('reports every capability that changed at once', () => {
    const previous = new Map([
      ['mixer', 'available' as const],
      ['lighting', 'degraded' as const],
    ])
    const current = new Map([
      ['mixer', 'missing' as const],
      ['lighting', 'available' as const],
    ])
    expect(diffCapabilities(previous, current)).toEqual(
      expect.arrayContaining([
        { capability: 'mixer', from: 'available', to: 'missing' },
        { capability: 'lighting', from: 'degraded', to: 'available' },
      ]),
    )
  })

  it('ignores a capability that only exists in one snapshot (install/uninstall, not a failure)', () => {
    const previous = new Map([['mixer', 'available' as const]])
    const current = new Map([
      ['mixer', 'available' as const],
      ['lighting', 'available' as const],
    ])
    expect(diffCapabilities(previous, current)).toEqual([])
  })
})
