import { describe, expect, it, vi } from 'vitest'
import type { StageSetup } from 'shared-types'

let resolveWrite: () => void = () => {}
vi.mock('../lib/stageMapDb', () => ({
  stageEquipmentDb: {},
  stageSetupsDb: { update: () => new Promise<void>((resolve) => (resolveWrite = resolve)) },
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
})
