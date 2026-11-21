import { describe, expect, it } from 'vitest'
import { isHostTarget } from 'shared-types'
import { targetWorldOf } from './targetWorldOf'

describe('targetWorldOf (#964)', () => {
  it('joins the host the device talks to with the listed ones, once each', () => {
    const world = targetWorldOf({ currentHostId: 'stage-pc', listedHostIds: ['stage-pc', 'tablet-1'], deviceIds: ['tablet-1'] })
    expect(world.hostIds).toEqual(['stage-pc', 'tablet-1'])
    expect(isHostTarget('stage-pc', world)).toBe(true)
    expect(isHostTarget('tablet-1', world)).toBe(false)
  })
  it('works before any host has answered', () => {
    expect(targetWorldOf({ currentHostId: undefined, listedHostIds: [], deviceIds: [] }).hostIds).toEqual([])
  })
})
