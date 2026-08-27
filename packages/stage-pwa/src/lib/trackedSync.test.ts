import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSyncStore } from '../store/useSyncStore'
import { __resetSyncQueueForTests, trackedSync } from './trackedSync'

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

/** A PouchDB.Replication.SyncResult<T>-shaped 'change' event payload, with just the field
 * trackedSync.ts actually reads. */
function changeInfo(docIds: string[]) {
  return { direction: 'pull', change: { docs: docIds.map((id) => ({ _id: id })) } }
}

/** trackedSync's start queue advances on a microtask chain (see trackedSync.ts) - a
 * macrotask flush guarantees every pending link in that chain has run. */
function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  useSyncStore.setState({ streams: {} })
  __resetSyncQueueForTests()
})

describe('trackedSync', () => {
  it('starts a live, retrying sync against the given remote', async () => {
    const { db } = fakeLocalDb()
    const remote = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, remote as any)
    await flush()
    expect(db.sync).toHaveBeenCalledWith(remote, { live: true, retry: true })
  })

  it('reports active once its turn in the start queue arrives', async () => {
    const { db } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    await flush()
    expect(useSyncStore.getState().streams.songs).toBe('active')
  })

  it('stays active on "active" and "change" events', async () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    await flush()

    emit('paused')
    expect(useSyncStore.getState().streams.songs).toBe('paused')

    emit('active')
    expect(useSyncStore.getState().streams.songs).toBe('active')

    emit('paused')
    emit('change', changeInfo(['song-1']))
    expect(useSyncStore.getState().streams.songs).toBe('active')
  })

  it('treats a plain "paused" (no error) as caught up', async () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    await flush()
    emit('paused')
    expect(useSyncStore.getState().streams.songs).toBe('paused')
  })

  it('treats a "paused" with an error as offline', async () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    await flush()
    emit('paused', new Error('network down'))
    expect(useSyncStore.getState().streams.songs).toBe('offline')
  })

  it('marks the stream errored on "error"', async () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    await flush()
    emit('error', new Error('fatal'))
    expect(useSyncStore.getState().streams.songs).toBe('error')
  })

  it('removes the stream entirely on "complete" (cancelled), instead of leaving a stale status', async () => {
    const { db, emit } = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('songs', db as any, {} as any)
    await flush()
    emit('complete')
    expect(useSyncStore.getState().streams).toEqual({})
  })

  it('cancelling before its queued turn arrives skips starting it entirely', async () => {
    const blocker = fakeLocalDb()
    const songs = fakeLocalDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    trackedSync('blocker', blocker.db as any, {} as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = trackedSync('songs', songs.db as any, {} as any)
    // 'blocker' gets its turn and starts; 'songs' is still waiting behind it.
    await flush()

    handle.cancel()
    blocker.emit('paused')
    await flush()

    expect(songs.db.sync).not.toHaveBeenCalled()
    expect(useSyncStore.getState().streams.songs).toBeUndefined()
  })

  describe('staggered startup (see #33 follow-up)', () => {
    it('does not start the next queued stream until the previous one settles', async () => {
      const songs = fakeLocalDb()
      const setlists = fakeLocalDb()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('songs', songs.db as any, {} as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('setlists', setlists.db as any, {} as any)
      await flush()

      // 'songs' got the first turn; 'setlists' is still waiting in the queue.
      expect(songs.db.sync).toHaveBeenCalledOnce()
      expect(setlists.db.sync).not.toHaveBeenCalled()
      expect(useSyncStore.getState().streams).toEqual({ songs: 'active' })

      songs.emit('paused')
      await flush()

      expect(setlists.db.sync).toHaveBeenCalledOnce()
      expect(useSyncStore.getState().streams).toEqual({ songs: 'paused', setlists: 'active' })
    })

    it('a stream that errors still releases the next one in line', async () => {
      const songs = fakeLocalDb()
      const setlists = fakeLocalDb()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('songs', songs.db as any, {} as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('setlists', setlists.db as any, {} as any)
      await flush()

      songs.emit('error', new Error('fatal'))
      await flush()

      expect(setlists.db.sync).toHaveBeenCalledOnce()
      expect(useSyncStore.getState().streams.setlists).toBe('active')
    })
  })

  describe('isNoiseDocId (see #33 follow-up: plugin-health heartbeat)', () => {
    it('treats a change batch made up entirely of noise doc ids as settled, not active', async () => {
      const { db, emit } = fakeLocalDb()
      trackedSync(
        'show-state',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        { isNoiseDocId: (id) => id === 'plugin-health' },
      )
      await flush()

      emit('change', changeInfo(['plugin-health']))

      expect(useSyncStore.getState().streams['show-state']).toBe('paused')
    })

    it('still counts as real activity when the batch has any non-noise doc mixed in', async () => {
      const { db, emit } = fakeLocalDb()
      trackedSync(
        'show-state',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        { isNoiseDocId: (id) => id === 'plugin-health' },
      )
      await flush()

      emit('change', changeInfo(['plugin-health', 'show-state']))

      expect(useSyncStore.getState().streams['show-state']).toBe('active')
    })

    it('a noise-only settle releases the next queued stream, same as a real pause', async () => {
      const meta = fakeLocalDb()
      const setlists = fakeLocalDb()
      trackedSync(
        'show-state',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        meta.db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        { isNoiseDocId: (id) => id === 'plugin-health' },
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('setlists', setlists.db as any, {} as any)
      await flush()

      meta.emit('change', changeInfo(['plugin-health']))
      await flush()

      expect(setlists.db.sync).toHaveBeenCalledOnce()
    })

    it('without isNoiseDocId, every change counts as real activity (unchanged default)', async () => {
      const { db, emit } = fakeLocalDb()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('songs', db as any, {} as any)
      await flush()

      emit('change', changeInfo(['anything']))

      expect(useSyncStore.getState().streams.songs).toBe('active')
    })

    it('an empty docs array is not treated as noise-only', async () => {
      const { db, emit } = fakeLocalDb()
      trackedSync(
        'show-state',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        { isNoiseDocId: (id) => id === 'plugin-health' },
      )
      await flush()

      emit('change', changeInfo([]))

      expect(useSyncStore.getState().streams['show-state']).toBe('active')
    })
  })
})
