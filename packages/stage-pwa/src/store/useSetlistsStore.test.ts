import { describe, expect, it, vi } from 'vitest'
import { SetlistSchema, type Setlist } from 'shared-types'

vi.mock('pouchdb-browser', () => ({ default: class {} }))
const { toSetlist } = await import('./useSetlistsStore')

describe('toSetlist', () => {
  it('keeps every field of a stored setlist - none may be dropped on the way back (gig date, Festival-Uhr schedule)', () => {
    const full: Setlist = {
      id: 's1',
      name: 'Sommerfest',
      entries: [{ id: 'e1', songId: 'a', variantId: null, trackId: null }],
      createdAt: 123,
      performanceDate: '2026-12-24',
      targetEndTime: '23:00',
      defaultTransitionMs: 15_000,
      defaultSongDurationMs: 240_000,
    }
    // Guard: if SetlistSchema gets a new field, this test must name it here too.
    expect(Object.keys(SetlistSchema.shape).sort()).toEqual(Object.keys(full).sort())
    const stored = { ...full, _id: 'setlists:s1', _rev: '3-x' }
    expect(toSetlist(stored as never)).toEqual(full)
  })

  it('still reads a legacy setlist that only had songIds', () => {
    const legacy = toSetlist({ _id: 'setlists:old', id: 'old', name: 'Alt', songIds: ['a', 'b'] } as never)
    expect(legacy.entries.map((e) => ('songId' in e ? e.songId : null))).toEqual(['a', 'b'])
    expect(legacy.createdAt).toBe(0)
  })
})
