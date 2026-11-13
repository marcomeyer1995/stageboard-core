import { describe, expect, it, vi } from 'vitest'
import type { StageSetup } from 'shared-types'

let resolveWrite: () => void = () => {}
const changes = () => ({ on: () => {}, cancel: () => {} })
const stored = { equipment: [] as unknown[], setups: [] as unknown[] }
vi.mock('../lib/stageMapDb', () => ({
  stageEquipmentDb: { switchWorkspace: () => {}, getAll: async () => stored.equipment, changes },
  stageSetupsDb: { switchWorkspace: () => {}, getAll: async () => stored.setups, changes, update: () => new Promise<void>((resolve) => (resolveWrite = resolve)) },
  stageFrontDb: { switchWorkspace: () => {}, getAll: async () => [], changes },
}))

const { useStageMapStore } = await import('./useStageMapStore')

describe('useStageMapStore', () => {
  it('shows a moved device at its new place before the write is done - it jumped back for a moment (2026-11-07)', async () => {
    const setup = { id: 'proberaum', name: 'Proberaum', positions: { fire: { x: 0, y: 0 } }, links: [], routing: {} } as unknown as StageSetup
    useStageMapStore.setState({ setups: [setup] })
    const write = useStageMapStore.getState().updateSetup('proberaum', (s) => ({ ...s, positions: { ...s.positions, fire: { x: 300, y: 120 } } }))
    expect(useStageMapStore.getState().setups[0]!.positions.fire).toEqual({ x: 300, y: 120 })
    resolveWrite()
    await write
  })

  it('keeps own setups and own equipment apart from the band\'s - nothing in the Gig reads them (#799)', async () => {
    stored.setups = [
      { id: 'standard', name: 'Standard', positions: {}, links: [], routing: {} },
      { id: 'home', name: 'Home', owner: 'marco', positions: {}, links: [], routing: {} },
    ]
    stored.equipment = [
      { id: 'pult', name: 'Pult', modelId: 'mixer', kind: 'mixer', ports: [] },
      { id: 'unit', name: 'Unit', modelId: 'mixer', kind: 'mixer', ports: [], owner: 'marco' },
    ]
    await useStageMapStore.getState().init('band')
    const state = useStageMapStore.getState()
    expect(state.setups.map((s) => s.id)).toEqual(['standard'])
    expect(state.ownSetups.map((s) => s.id)).toEqual(['home'])
    expect(state.equipment.map((e) => e.id)).toEqual(['pult'])
    expect(state.ownEquipment.map((e) => e.id)).toEqual(['unit'])
  })
})
