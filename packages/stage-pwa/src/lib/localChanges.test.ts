import { describe, expect, it, vi } from 'vitest'
import { watchLocalChanges } from './localChanges'

/** A PouchDB stand-in with a live changes feed that tests drive by hand. */
function fakeDb() {
  const feeds: { listener: ((change: { id: string; seq: number }) => void) | null; cancelled: boolean; options: object }[] = []
  const db = {
    changes: vi.fn((options: object) => {
      const feed = { listener: null as ((change: { id: string; seq: number }) => void) | null, cancelled: false, options }
      feeds.push(feed)
      const handle = {
        on: (event: string, listener: (change: { id: string; seq: number }) => void) => {
          if (event === 'change') feed.listener = listener
          return handle
        },
        cancel: () => {
          feed.cancelled = true
        },
      }
      return handle
    }),
  }
  let seq = 0
  const emit = (id: string) => feeds.filter((f) => !f.cancelled).forEach((f) => f.listener?.({ id, seq: ++seq }))
  return { db: db as unknown as PouchDB.Database<object>, feeds, emit }
}

describe('watchLocalChanges', () => {
  it('opens one unfiltered feed per db, however many subscribers, and dispatches by id', () => {
    const { db, feeds, emit } = fakeDb()
    const songs: string[] = []
    const state: string[] = []
    watchLocalChanges(db, (id) => id.startsWith('songs:')).on('change', (c) => songs.push(c.id))
    watchLocalChanges(db, (id) => id === 'show-state').on('change', (c) => state.push(c.id))

    emit('show-state')
    emit('songs:1')
    emit('setlists:1')

    expect(feeds).toHaveLength(1)
    // No filter: an unfiltered feed advances past every change (a filtered one didn't - the
    // growing re-read behind the ~1 s freeze on Play, 2026-09-27).
    expect(feeds[0].options).toEqual({ since: 'now', live: true, include_docs: true })
    expect(songs).toEqual(['songs:1'])
    expect(state).toEqual(['show-state'])
  })

  it('stops the feed after the last subscriber cancels, and starts a fresh one for the next', () => {
    const { db, feeds, emit } = fakeDb()
    const a = watchLocalChanges(db, () => true)
    const b = watchLocalChanges(db, () => true)
    a.cancel()
    expect(feeds[0].cancelled).toBe(false)
    b.cancel()
    expect(feeds[0].cancelled).toBe(true)

    const seen: string[] = []
    watchLocalChanges(db, () => true).on('change', (c) => seen.push(c.id))
    emit('x')
    expect(feeds).toHaveLength(2)
    expect(seen).toEqual(['x'])
  })

  it('lets a listener cancel its own subscription while a change is being dispatched', () => {
    const { db, emit } = fakeDb()
    const seen: string[] = []
    const first = watchLocalChanges(db, () => true)
    first.on('change', () => first.cancel())
    watchLocalChanges(db, () => true).on('change', (c) => seen.push(c.id))
    emit('x')
    emit('y')
    expect(seen).toEqual(['x', 'y'])
  })
})
