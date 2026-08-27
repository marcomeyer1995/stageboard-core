import { beforeEach, describe, expect, it } from 'vitest'
import { deriveSyncStatus, useSyncStore } from './useSyncStore'

beforeEach(() => {
  useSyncStore.setState({ streams: {} })
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
