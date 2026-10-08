import { describe, expect, it } from 'vitest'
import type { Dashboard } from 'shared-types'
import { inMenuOrder, mergeOrder } from './useDashboardMenuStore'

const board = (id: string, order: number): Dashboard => ({ id, name: id, order, widgets: [], layouts: {}, visibility: 'public' })

describe('inMenuOrder', () => {
  it("dragged ones first as dragged, the rest in the band's order after them", () => {
    const all = [board('a', 0), board('b', 1), board('c', 2), board('d', 3)]
    expect(inMenuOrder(all, ['c', 'a']).map((d) => d.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(inMenuOrder(all, []).map((d) => d.id)).toEqual(['a', 'b', 'c', 'd'])
    // An id of a deleted dashboard in the saved order is simply skipped.
    expect(inMenuOrder(all, ['gone', 'd']).map((d) => d.id)).toEqual(['d', 'a', 'b', 'c'])
  })
})

describe('mergeOrder (#422 review)', () => {
  it('arranging one mode keeps the order arranged in the other mode', () => {
    // Gig was arranged C, A, B; Solo lists B and D and is dragged to D, B.
    const merged = mergeOrder(['c', 'a', 'b'], ['d', 'b'])
    const all = [board('a', 0), board('b', 1), board('c', 2), board('d', 3)]
    const gig = all.filter((d) => d.id !== 'd')
    const solo = all.filter((d) => d.id === 'b' || d.id === 'd')
    expect(inMenuOrder(gig, merged).map((d) => d.id)).toEqual(['c', 'a', 'b'])
    expect(inMenuOrder(solo, merged).map((d) => d.id)).toEqual(['d', 'b'])
  })
})
