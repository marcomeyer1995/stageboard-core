import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CAPABILITIES, DEFAULT_SHOW_STATE, defaultStageMap, mapPlays } from 'shared-types'

// workspaceDb.ts constructs a real PouchDB at module load time - unavailable under happy-dom.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useShowStateStore } = await import('../store/useShowStateStore')
const { useStageMapStore } = await import('../store/useStageMapStore')
const { useOutputPlan } = await import('./useOutputPlan')

describe('useOutputPlan', () => {
  it('hands the setup the master chose to the map: the click moves to the other tablet (#745)', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }, { id: 'fire', name: 'Fire' }])
    const standard = map.setups[0]!
    const click = (portId: string) => [{ from: { kind: 'virtual' as const, virtualPortId: 'klick' }, to: { kind: 'port' as const, portId } }]
    standard.routing = { 'device:redmi': click('headphones'), 'device:fire': [] }
    const club = { ...standard, id: 'club', name: 'Club', routing: { 'device:redmi': [], 'device:fire': click('headphones') } }
    useStageMapStore.setState({ equipment: map.equipment, setups: [standard, club], loaded: true })
    const plays = () => ['redmi', 'fire'].map((id) => mapPlays(useStageMapStore.getState(), id, CAPABILITIES.clickTrack))

    renderHook(() => useOutputPlan())
    expect(plays()).toEqual([true, false])
    act(() => useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, activeSetupId: 'club' } }))
    expect(plays()).toEqual([false, true])
    act(() => useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, activeSetupId: null } }))
    expect(plays()).toEqual([true, false])
  })
})
