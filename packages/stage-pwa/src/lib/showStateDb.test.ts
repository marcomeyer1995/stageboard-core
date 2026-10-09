import { describe, expect, it, vi } from 'vitest'

/** A database that, like CouchDB, rejects a write with a stale revision (409). */
const store: { doc: Record<string, unknown> | null; rev: number } = { doc: null, rev: 0 }
const fakeDb = {
  get: vi.fn(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1))
    if (!store.doc) throw Object.assign(new Error('missing'), { status: 404 })
    return { ...store.doc, _rev: String(store.rev) }
  }),
  put: vi.fn(async (doc: Record<string, unknown>) => {
    await new Promise((resolve) => setTimeout(resolve, 1))
    if (String(doc._rev ?? '0') !== String(store.rev)) throw Object.assign(new Error('conflict'), { status: 409 })
    store.rev++
    store.doc = { ...doc }
  }),
}
vi.mock('./workspaceDb', () => ({ getWorkspaceDb: () => fakeDb }))
vi.mock('./localChanges', () => ({ watchLocalChanges: vi.fn() }))

const { putShowState } = await import('./showStateDb')

describe('putShowState (#468)', () => {
  it('"Weiter, Weiter, Play" fired at once all land - none silently dropped by a revision conflict', async () => {
    await Promise.all([
      putShowState({ activeEntryId: 'b', stateIssuedAt: 1 }),
      putShowState({ activeEntryId: 'c', stateIssuedAt: 2 }),
      putShowState({ playbackStatus: 'playing', stateIssuedAt: 3 }),
    ])
    expect(store.doc).toMatchObject({ activeEntryId: 'c', playbackStatus: 'playing', stateIssuedAt: 3 })
    expect(store.rev).toBe(3)
  })
})
