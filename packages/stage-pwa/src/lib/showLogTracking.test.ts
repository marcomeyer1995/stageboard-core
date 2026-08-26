import { describe, expect, it } from 'vitest'
import { diffCapabilities, shouldConfirmSong, shouldStartNewShow } from './showLogTracking'

describe('shouldConfirmSong', () => {
  it('confirms a song that has been active at least the minimum duration', () => {
    const pending = { songId: 'a', songTitle: 'A', startedAt: 1000 }
    expect(shouldConfirmSong(pending, 1000 + 20_000, 20_000)).toBe(true)
    expect(shouldConfirmSong(pending, 1000 + 30_000, 20_000)).toBe(true)
  })

  it('discards a song stopped before the minimum duration - a corrected wrong tap', () => {
    const pending = { songId: 'a', songTitle: 'A', startedAt: 1000 }
    expect(shouldConfirmSong(pending, 1000 + 5_000, 20_000)).toBe(false)
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
