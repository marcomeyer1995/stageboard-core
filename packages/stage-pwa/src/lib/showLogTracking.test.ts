import { describe, expect, it } from 'vitest'
import { advanceSongTracking, diffCapabilities, shouldConfirmSong, shouldStartNewShow, type SongTrackingState } from './showLogTracking'

describe('shouldConfirmSong', () => {
  it('confirms a song that has been active at least the minimum duration', () => {
    const pending = { entryId: 'e1', songId: 'a', songTitle: 'A', startedAt: 1000 }
    expect(shouldConfirmSong(pending, 1000 + 20_000, 20_000)).toBe(true)
    expect(shouldConfirmSong(pending, 1000 + 30_000, 20_000)).toBe(true)
  })

  it('discards a song stopped before the minimum duration - a corrected wrong tap', () => {
    const pending = { entryId: 'e1', songId: 'a', songTitle: 'A', startedAt: 1000 }
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

describe('advanceSongTracking', () => {
  const EMPTY_STATE: SongTrackingState = { pendingSong: null, currentShowId: null, lastActivityAt: null }

  it('starts a show and begins tracking the first song', () => {
    const result = advanceSongTracking(EMPTY_STATE, { id: 'e1', songId: 'a', songTitle: 'A' }, 1000, 'show-1')
    expect(result?.events).toEqual({
      songPlayed: null,
      showStarted: { showId: 'show-1', at: 1000 },
    })
    expect(result?.nextState).toEqual({
      pendingSong: { entryId: 'e1', songId: 'a', songTitle: 'A', startedAt: 1000 },
      currentShowId: 'show-1',
      lastActivityAt: 1000,
    })
  })

  it('confirms the previous song once it met the minimum duration, then tracks the next one', () => {
    const state: SongTrackingState = {
      pendingSong: { entryId: 'e1', songId: 'a', songTitle: 'A', startedAt: 1000 },
      currentShowId: 'show-1',
      lastActivityAt: 1000,
    }
    const now = 1000 + 30_000
    const result = advanceSongTracking(state, { id: 'e2', songId: 'b', songTitle: 'B' }, now, 'show-2')
    expect(result?.events.songPlayed).toEqual({
      showId: 'show-1',
      songId: 'a',
      songTitle: 'A',
      at: 1000,
      endedAt: now,
    })
    expect(result?.events.showStarted).toBeNull()
    expect(result?.nextState).toEqual({
      pendingSong: { entryId: 'e2', songId: 'b', songTitle: 'B', startedAt: now },
      currentShowId: 'show-1',
      lastActivityAt: now,
    })
  })

  it('discards the previous song if it never met the minimum duration - a corrected wrong tap', () => {
    const state: SongTrackingState = {
      pendingSong: { entryId: 'e1', songId: 'a', songTitle: 'A', startedAt: 1000 },
      currentShowId: 'show-1',
      lastActivityAt: 1000,
    }
    const now = 1000 + 5_000
    const result = advanceSongTracking(state, { id: 'e2', songId: 'b', songTitle: 'B' }, now, 'show-2')
    expect(result?.events.songPlayed).toBeNull()
  })

  it('does not reset an in-progress song when the Master-Token changes hands mid-song (#4)', () => {
    const state: SongTrackingState = {
      pendingSong: { entryId: 'e1', songId: 'a', songTitle: 'A', startedAt: 1000 },
      currentShowId: 'show-1',
      lastActivityAt: 1000,
    }
    // Same entry still active - only the master holder changed, not the song.
    const result = advanceSongTracking(state, { id: 'e1', songId: 'a', songTitle: 'A' }, 1000 + 10_000, 'show-2')
    expect(result).toBeNull()
  })

  it('confirms a song with its true original start time even after a mid-song handoff delayed the check', () => {
    // The song started at 1000 on the outgoing master; a new master only takes over, and only
    // notices the next song change, well after the 20s threshold would already have passed.
    const state: SongTrackingState = {
      pendingSong: { entryId: 'e1', songId: 'a', songTitle: 'A', startedAt: 1000 },
      currentShowId: 'show-1',
      lastActivityAt: 1000,
    }
    const now = 1000 + 60_000
    const result = advanceSongTracking(state, { id: 'e2', songId: 'b', songTitle: 'B' }, now, 'show-2')
    expect(result?.events.songPlayed).toEqual({
      showId: 'show-1',
      songId: 'a',
      songTitle: 'A',
      at: 1000,
      endedAt: now,
    })
  })

  it('starts a new show once the gap threshold has passed, using the new showId for the confirmed song', () => {
    const state: SongTrackingState = {
      pendingSong: { entryId: 'e1', songId: 'a', songTitle: 'A', startedAt: 1000 },
      currentShowId: 'show-1',
      lastActivityAt: 1000,
    }
    const now = 1000 + 46 * 60_000
    const result = advanceSongTracking(state, { id: 'e2', songId: 'b', songTitle: 'B' }, now, 'show-2')
    // The confirmed song still belongs to the show it was actually played in.
    expect(result?.events.songPlayed?.showId).toBe('show-1')
    expect(result?.events.showStarted).toEqual({ showId: 'show-2', at: now })
    expect(result?.nextState.currentShowId).toBe('show-2')
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
