import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncStore } from '../store/useSyncStore'
import { trackedSync } from './trackedSync'

/** Minimal stand-in for PouchDB.Replication.Sync<T>: a chainable `.on()` plus a way for the
 * test to fire an event, without spinning up real PouchDB/IndexedDB replication. */
function fakeSyncHandle() {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {}
  const handle = {
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      ;(handlers[event] ??= []).push(cb)
      return handle
    }),
    cancel: vi.fn(),
  }
  return {
    handle,
    emit: (event: string, ...args: unknown[]) => {
      for (const cb of handlers[event] ?? []) cb(...args)
    },
  }
}

function fakeLocalDb() {
  const { handle, emit } = fakeSyncHandle()
  return { db: { sync: vi.fn(() => handle) }, emit }
}

beforeEach(() => {
  useSyncStore.setState({ streams: {} })
})

describe('trackedSync', () => {
  it('starts a live, retrying sync against the given remote', () => {
    const { db } = fakeLocalDb()
    const remote = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, remote as any)
    expect(db.sync).toHaveBeenCalledWith(remote, { live: true, retry: true })
  })

  it('reports active immediately, before any event fires', () => {
    const { db } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    expect(useSyncStore.getState().streams.songs).toBe('active')
  })

  it('stays active on "active" and "change" events', () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)

    emit('paused')
    expect(useSyncStore.getState().streams.songs).toBe('paused')

    emit('active')
    expect(useSyncStore.getState().streams.songs).toBe('active')

    emit('paused')
    emit('change')
    expect(useSyncStore.getState().streams.songs).toBe('active')
  })

  it('treats a plain "paused" (no error) as caught up', () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    emit('paused')
    expect(useSyncStore.getState().streams.songs).toBe('paused')
  })

  it('treats a "paused" with an error as offline', () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    emit('paused', new Error('network down'))
    expect(useSyncStore.getState().streams.songs).toBe('offline')
  })

  it('marks the stream errored on "error"', () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    emit('error', new Error('fatal'))
    expect(useSyncStore.getState().streams.songs).toBe('error')
  })

  it('removes the stream entirely on "complete" (cancelled), instead of leaving a stale status', () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    emit('complete')
    expect(useSyncStore.getState().streams).toEqual({})
  })

  it('keeps each named stream independent', () => {
    const songs = fakeLocalDb()
    const setlists = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', songs.db as any, {} as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('setlists', setlists.db as any, {} as any)

    songs.emit('paused')

    expect(useSyncStore.getState().streams).toEqual({ songs: 'paused', setlists: 'active' })
  })
})
