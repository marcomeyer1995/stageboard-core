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

/** A PouchDB.Replication.SyncResult<T>-shaped 'change' event payload, with just the fields
 * trackedSync.ts actually reads. `pending` isn't in @types/pouchdb-replication's declared
 * shape but is present at runtime when the remote is CouchDB 2.0+ (see trackedSync.ts). */
function changeInfo(
  docIds: string[],
  options: { direction?: 'push' | 'pull'; pending?: number } = {},
) {
  return {
    direction: options.direction ?? 'pull',
    change: { docs: docIds.map((id) => ({ _id: id })), pending: options.pending },
  }
}

/** trackedSync's start queue advances on a microtask chain (see trackedSync.ts) - a
 * macrotask flush guarantees every pending link in that chain has run. */
function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  useSyncStore.setState({ streams: {}, progress: {} })
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

  describe('pull progress (see #49 follow-up: sync percentage)', () => {
    it('records pending from a pull change batch', async () => {
      const { db, emit } = fakeLocalDb()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('songs', db as any, {} as any)
      await flush()

      emit('change', changeInfo(['song-1'], { direction: 'pull', pending: 7 }))

      expect(useSyncStore.getState().progress.songs).toEqual({ pending: 7, initialPending: 7 })
    })

    it('ignores pending on a push change batch - the local adapter never reports one', async () => {
      const { db, emit } = fakeLocalDb()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('songs', db as any, {} as any)
      await flush()

      emit('change', changeInfo(['song-1'], { direction: 'push', pending: 7 }))

      expect(useSyncStore.getState().progress.songs).toBeUndefined()
    })

    it('clears progress on a real "paused" (caught up), so a finished run does not linger', async () => {
      const { db, emit } = fakeLocalDb()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('songs', db as any, {} as any)
      await flush()

      emit('change', changeInfo(['song-1'], { pending: 7 }))
      expect(useSyncStore.getState().progress.songs).toBeDefined()

      emit('paused')
      expect(useSyncStore.getState().progress.songs).toBeUndefined()
    })

    it('clears progress on "error" and on "complete", same as a real pause', async () => {
      const errored = fakeLocalDb()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('songs', errored.db as any, {} as any)
      await flush()
      errored.emit('change', changeInfo(['song-1'], { pending: 7 }))
      errored.emit('error', new Error('fatal'))
      expect(useSyncStore.getState().progress.songs).toBeUndefined()

      const completed = fakeLocalDb()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('setlists', completed.db as any, {} as any)
      await flush()
      completed.emit('change', changeInfo(['setlist-1'], { pending: 3 }))
      completed.emit('complete')
      expect(useSyncStore.getState().progress.setlists).toBeUndefined()
    })

    it('a noise-only batch does not reset the progress a real batch already reported (regression: was stuck at 0%)', async () => {
      const { db, emit } = fakeLocalDb()
      trackedSync(
        'show-state',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        { isNoiseDocId: (id) => id === 'heartbeat-noise' },
      )
      await flush()

      // A real batch establishes real progress...
      emit('change', changeInfo(['show-state-1'], { direction: 'pull', pending: 10 }))
      expect(useSyncStore.getState().progress['show-state']).toEqual({
        pending: 10,
        initialPending: 10,
      })

      // ...the next batch makes real headway...
      emit('change', changeInfo(['show-state-2'], { direction: 'pull', pending: 6 }))
      expect(useSyncStore.getState().progress['show-state']).toEqual({
        pending: 6,
        initialPending: 10,
      })

      // ...and a noisy heartbeat-style batch in between (which reports its own "pending",
      // since it's a real change batch, just not user-visible activity) must not wipe or
      // reseed that progress - previously this synthesized a 'paused' via report(), which
      // cleared progress, then immediately re-seeded a fresh 0%-done baseline from this
      // batch's own pending value, pinning the percentage at 0% forever.
      emit('change', changeInfo(['heartbeat-noise'], { direction: 'pull', pending: 5 }))
      expect(useSyncStore.getState().progress['show-state']).toEqual({
        pending: 6,
        initialPending: 10,
      })
    })
  })

  describe('isNoiseDocId (general-purpose noise filtering, not tied to any one stream)', () => {
    it('treats a change batch made up entirely of noise doc ids as settled, not active', async () => {
      const { db, emit } = fakeLocalDb()
      trackedSync(
        'example-stream',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        { isNoiseDocId: (id) => id === 'heartbeat-noise' },
      )
      await flush()

      emit('change', changeInfo(['heartbeat-noise']))

      expect(useSyncStore.getState().streams['example-stream']).toBe('paused')
    })

    it('still counts as real activity when the batch has any non-noise doc mixed in', async () => {
      const { db, emit } = fakeLocalDb()
      trackedSync(
        'example-stream',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        { isNoiseDocId: (id) => id === 'heartbeat-noise' },
      )
      await flush()

      emit('change', changeInfo(['heartbeat-noise', 'real-doc']))

      expect(useSyncStore.getState().streams['example-stream']).toBe('active')
    })

    it('a noise-only settle releases the next queued stream, same as a real pause', async () => {
      const noisy = fakeLocalDb()
      const setlists = fakeLocalDb()
      trackedSync(
        'example-stream',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        noisy.db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        { isNoiseDocId: (id) => id === 'heartbeat-noise' },
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      trackedSync('setlists', setlists.db as any, {} as any)
      await flush()

      noisy.emit('change', changeInfo(['heartbeat-noise']))
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
        'example-stream',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        db as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any,
        { isNoiseDocId: (id) => id === 'heartbeat-noise' },
      )
      await flush()

      emit('change', changeInfo([]))

      expect(useSyncStore.getState().streams['example-stream']).toBe('active')
    })
  })
})
