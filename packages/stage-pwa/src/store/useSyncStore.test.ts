import { beforeEach, describe, expect, it } from 'vitest'
import { deriveSyncProgress, deriveSyncStatus, useSyncStore } from './useSyncStore'

beforeEach(() => {
  useSyncStore.setState({ streams: {}, progress: {} })
})

describe('useSyncStore', () => {
  it('setStreamStatus adds/overwrites a stream entry', () => {
    useSyncStore.getState().setStreamStatus('songs', 'active')
    expect(useSyncStore.getState().streams).toEqual({ songs: 'active' })

    useSyncStore.getState().setStreamStatus('songs', 'paused')
    expect(useSyncStore.getState().streams).toEqual({ songs: 'paused' })
  })

  it('tracks multiple streams independently', () => {
    useSyncStore.getState().setStreamStatus('songs', 'paused')
    useSyncStore.getState().setStreamStatus('setlists', 'active')
    expect(useSyncStore.getState().streams).toEqual({ songs: 'paused', setlists: 'active' })
  })

  it('clearStream removes just that one entry', () => {
    useSyncStore.getState().setStreamStatus('songs', 'paused')
    useSyncStore.getState().setStreamStatus('setlists', 'active')
    useSyncStore.getState().clearStream('songs')
    expect(useSyncStore.getState().streams).toEqual({ setlists: 'active' })
  })

  it('clearStream on an unknown name is a no-op', () => {
    useSyncStore.getState().setStreamStatus('songs', 'paused')
    useSyncStore.getState().clearStream('nope')
    expect(useSyncStore.getState().streams).toEqual({ songs: 'paused' })
  })
})

describe('deriveSyncStatus', () => {
  it('is idle with no streams at all', () => {
    expect(deriveSyncStatus({})).toBe('idle')
  })

  it('is idle once every stream is paused (the "Synced" state)', () => {
    expect(deriveSyncStatus({ songs: 'paused', setlists: 'paused' })).toBe('idle')
  })

  it('is syncing while any stream is active, even if others are caught up', () => {
    expect(deriveSyncStatus({ songs: 'paused', setlists: 'active' })).toBe('syncing')
  })

  it('is offline if any stream is offline and none are erroring', () => {
    expect(deriveSyncStatus({ songs: 'paused', setlists: 'offline' })).toBe('offline')
  })

  it('is error if any stream errors, even if others are fine - worst signal wins', () => {
    expect(deriveSyncStatus({ songs: 'active', setlists: 'offline', dashboards: 'error' })).toBe('error')
  })
})

describe('setStreamProgress / clearStreamProgress', () => {
  it('records pending and seeds initialPending from the first value seen', () => {
    useSyncStore.getState().setStreamProgress('songs', 12)
    expect(useSyncStore.getState().progress.songs).toEqual({ pending: 12, initialPending: 12 })
  })

  it('keeps initialPending as pending falls, so percentage climbs toward done', () => {
    useSyncStore.getState().setStreamProgress('songs', 12)
    useSyncStore.getState().setStreamProgress('songs', 5)
    expect(useSyncStore.getState().progress.songs).toEqual({ pending: 5, initialPending: 12 })
  })

  it('grows initialPending if new pending work shows up mid-sync, rather than lying', () => {
    useSyncStore.getState().setStreamProgress('songs', 4)
    useSyncStore.getState().setStreamProgress('songs', 9)
    expect(useSyncStore.getState().progress.songs).toEqual({ pending: 9, initialPending: 9 })
  })

  it('clearStreamProgress removes just that one entry', () => {
    useSyncStore.getState().setStreamProgress('songs', 4)
    useSyncStore.getState().setStreamProgress('setlists', 9)
    useSyncStore.getState().clearStreamProgress('songs')
    expect(useSyncStore.getState().progress).toEqual({ setlists: { pending: 9, initialPending: 9 } })
  })

  it('clearStreamProgress on an unknown name is a no-op', () => {
    useSyncStore.getState().setStreamProgress('songs', 4)
    useSyncStore.getState().clearStreamProgress('nope')
    expect(useSyncStore.getState().progress).toEqual({ songs: { pending: 4, initialPending: 4 } })
  })
})

describe('deriveSyncProgress', () => {
  it('is null with no progress reported at all', () => {
    expect(deriveSyncProgress({})).toBeNull()
  })

  it('is null when every entry has nothing pending (0/0 is not "0% done")', () => {
    expect(deriveSyncProgress({ songs: { pending: 0, initialPending: 0 } })).toBeNull()
  })

  it("computes a single stream's own percentage", () => {
    expect(deriveSyncProgress({ songs: { pending: 25, initialPending: 100 } })).toBe(75)
  })

  it('aggregates multiple streams by total work, not a simple average', () => {
    // songs: 90/100 done, setlists: 0/10 done - weighted by size, not (90%+0%)/2.
    const progress = {
      songs: { pending: 10, initialPending: 100 },
      setlists: { pending: 10, initialPending: 10 },
    }
    expect(deriveSyncProgress(progress)).toBe(82)
  })

  it('ignores a finished (0/0) stream sitting alongside an active one', () => {
    const progress = {
      songs: { pending: 0, initialPending: 0 },
      setlists: { pending: 5, initialPending: 20 },
    }
    expect(deriveSyncProgress(progress)).toBe(75)
  })
})
