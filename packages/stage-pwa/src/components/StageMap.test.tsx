import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultStageMap, equipmentFrom, BUILTIN_MODELS } from 'shared-types'

// workspaceDb.ts constructs a real PouchDB at module load time - unavailable under happy-dom.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { getDeviceId } = await import('../lib/deviceId')
const { useDevicesStore } = await import('../store/useDevicesStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useActiveProfileStore } = await import('../store/useActiveProfileStore')
const { useProfilesStore } = await import('../store/useProfilesStore')
const { usePresenceStore } = await import('../store/usePresenceStore')
const { useStageMapStore } = await import('../store/useStageMapStore')
const { StageMap } = await import('./StageMap')

const me = getDeviceId()
const updateSetup = vi.fn().mockResolvedValue(undefined)
const saveEquipment = vi.fn().mockResolvedValue(undefined)

function setUp(isAdmin: boolean) {
  const map = defaultStageMap([{ id: me, name: 'Redmi' }, { id: 'fire', name: 'Fire' }])
  const mixer = equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'mixer')!, 'pult', 'Pult')
  map.equipment.push(mixer)
  map.setups[0]!.positions.pult = { x: 400, y: 600 }
  map.setups[0]!.links.push({ id: 'cable', from: { equipmentId: `device:${me}`, portId: 'headphones' }, to: { equipmentId: 'pult', portId: 'in', channel: 15 }, signals: ['audio'] })
  useStageMapStore.setState({ ...map, loaded: true, updateSetup, saveEquipment })
  useDevicesStore.setState({
    loaded: true,
    devices: [
      { id: me, name: 'Redmi', lastSeenAt: Date.now(), firstSeenAt: 0, revoked: false },
      { id: 'fire', name: 'Fire', lastSeenAt: Date.now(), firstSeenAt: 0, revoked: false },
    ],
  })
  useWorkspaceStore.setState({ workspaces: [{ id: 'band', name: 'Band', isAdmin } as never], activeWorkspaceId: 'band' })
  useActiveProfileStore.setState({ byWorkspace: { band: 'p-marco' } })
  useProfilesStore.setState({ profiles: [{ id: 'p-marco', name: 'Marco' }, { id: 'p-kai', name: 'Kai' }] as never })
  usePresenceStore.setState({ presence: { devices: { [me]: { profileId: 'p-marco', lastSeenAt: 0 }, fire: { profileId: 'p-kai', lastSeenAt: 0 } } } })
}

const tapNode = (name: string) => {
  const node = screen.getAllByText(name).find((el) => el.tagName.toLowerCase() === 'text')!.parentElement!
  fireEvent.pointerDown(node, { pointerId: 1 })
  fireEvent.pointerUp(node, { pointerId: 1 })
}

beforeEach(() => {
  updateSetup.mockClear()
  saveEquipment.mockClear()
})

describe('StageMap (docs/31 §7)', () => {
  it('shows the default map - who is signed in where, and what is patched on each speaker - and writes nothing', () => {
    setUp(false)
    render(<StageMap />)
    expect(screen.getAllByText('Klick · Track · Ansagen')).toHaveLength(2)
    expect(screen.getByText('an Fire')).toBeInTheDocument()
    expect(updateSetup).not.toHaveBeenCalled()
    expect(saveEquipment).not.toHaveBeenCalled()
  })

  it('a member wires their own device but not the mixer; equipment stays with the admin', () => {
    setUp(false)
    render(<StageMap />)
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Redmi')
    expect(screen.getAllByRole('button', { name: 'Verbinden' }).length).toBeGreaterThan(0)
    tapNode('Pult')
    expect(screen.queryByRole('button', { name: 'Verbinden' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Löschen' })).toBeNull()
  })

  it('a cable into the mixer reaches nobody until an output is ticked, and the tick is written', () => {
    setUp(true)
    render(<StageMap />)
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Redmi')
    fireEvent.click(screen.getByRole('button', { name: '→ Pult · Eingänge 15' }))
    expect(screen.getByText('Nichts angehakt - geht im Pult nirgendwohin.')).toBeInTheDocument()
    expect(screen.getByText(/kommt nirgends an/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Aux / Monitor 1' }))
    expect(updateSetup).toHaveBeenCalledTimes(1)
    const [, patch] = updateSetup.mock.calls[0]!
    const after = patch(useStageMapStore.getState().setups[0])
    expect(after.links.find((l: { id: string }) => l.id === 'cable').routes).toEqual([{ portId: 'aux', channel: 1 }])
  })
})
