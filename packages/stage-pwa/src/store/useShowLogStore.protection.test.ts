import { describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ deleted: [] as string[][], put: vi.fn(), removed: vi.fn() }))
vi.mock('../lib/showLogDb', () => ({
  deleteShowEvents: async (ids: string[]) => {
    db.deleted.push(ids)
    return ids.length
  },
  putShowProtection: db.put,
  removeShowProtection: db.removed,
  getAllShowLogEvents: async () => [],
  getAllShowProtections: async () => [],
  putShowLogEvent: vi.fn(),
  showLogChanges: () => ({ on: vi.fn(), cancel: vi.fn() }),
  showProtectionChanges: () => ({ on: vi.fn(), cancel: vi.fn() }),
  switchShowLogWorkspace: vi.fn(),
  switchShowProtectionWorkspace: vi.fn(),
}))

const { useShowLogStore } = await import('./useShowLogStore')

describe('useShowLogStore - delete and protect (#610)', () => {
  it('never deletes a protected show, even when asked to', async () => {
    useShowLogStore.setState({ protectedShowIds: ['b'] })
    expect(await useShowLogStore.getState().deleteShows(['a', 'b', 'c'])).toBe(2)
    expect(db.deleted).toEqual([['a', 'c']])
    expect(await useShowLogStore.getState().deleteShows(['b'])).toBe(0)
    expect(db.deleted).toHaveLength(1)
  })

  it('protects with one band-wide document per show and unprotects by removing it', async () => {
    await useShowLogStore.getState().setProtected('a', true, 'marco')
    expect(db.put).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', byProfileId: 'marco' }))
    await useShowLogStore.getState().setProtected('a', false, 'marco')
    expect(db.removed).toHaveBeenCalledWith('a')
  })
})
