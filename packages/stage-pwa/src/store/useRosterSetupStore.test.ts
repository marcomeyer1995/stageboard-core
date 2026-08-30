import { beforeEach, describe, expect, it } from 'vitest'
import { useRosterSetupStore } from './useRosterSetupStore'

beforeEach(() => {
  useRosterSetupStore.setState({ completedFor: {} })
})

describe('useRosterSetupStore', () => {
  it('is not completed for a workspace by default', () => {
    expect(useRosterSetupStore.getState().completedFor['band-a']).toBeUndefined()
  })

  it('complete() marks only the given workspace, leaving others untouched', () => {
    useRosterSetupStore.getState().complete('band-a')

    const state = useRosterSetupStore.getState()
    expect(state.completedFor['band-a']).toBe(true)
    expect(state.completedFor['band-b']).toBeUndefined()
  })
})
