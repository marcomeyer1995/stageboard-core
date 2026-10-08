import { describe, expect, it } from 'vitest'
import type { Dashboard } from 'shared-types'
import { inMenuOrder } from './useDashboardMenuStore'

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
