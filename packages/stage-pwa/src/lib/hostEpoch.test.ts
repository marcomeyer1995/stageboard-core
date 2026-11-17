import { beforeEach, describe, expect, it } from 'vitest'
import { useHostEpochStore } from './hostEpoch'

beforeEach(() => useHostEpochStore.setState({ highestEpoch: 0, staleHost: false }))

describe('useHostEpochStore (#910)', () => {
  it('flags a host announcing a lower epoch than one already seen, and not an equal or higher one', () => {
    const { observe } = useHostEpochStore.getState()
    observe(2)
    observe(1)
    expect(useHostEpochStore.getState().staleHost).toBe(true)
    observe(2)
    expect(useHostEpochStore.getState().staleHost).toBe(false)
    observe(3)
    expect(useHostEpochStore.getState().staleHost).toBe(false)
  })

  it('only ever raises the highest epoch seen', () => {
    const { observe } = useHostEpochStore.getState()
    observe(3)
    observe(1)
    expect(useHostEpochStore.getState().highestEpoch).toBe(3)
  })

  it('ignores a host that announces no epoch (older build)', () => {
    const { observe } = useHostEpochStore.getState()
    observe(2)
    observe(undefined)
    expect(useHostEpochStore.getState()).toMatchObject({ highestEpoch: 2, staleHost: false })
  })
})
