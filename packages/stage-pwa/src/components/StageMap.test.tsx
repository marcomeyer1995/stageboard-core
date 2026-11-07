import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultStageMap, equipmentFrom, BUILTIN_MODELS, type StageSetup } from 'shared-types'

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
const { DialogHost } = await import('./DialogHost')

const me = getDeviceId()
const updateSetup = vi.fn().mockResolvedValue(undefined)
const saveEquipment = vi.fn().mockResolvedValue(undefined)

function setUp(isAdmin: boolean) {
  const map = defaultStageMap([{ id: me, name: 'Redmi' }, { id: 'fire', name: 'Fire' }])
  const mixer = equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'mixer')!, 'pult', 'Pult')
  map.equipment.push(mixer)
  map.setups[0]!.positions.pult = { x: 400, y: 600 }
  map.setups[0]!.links.push({ id: 'cable', from: { equipmentId: `device:${me}`, portId: 'headphones' }, to: { equipmentId: 'pult', portId: 'in', channel: 15 }, signals: ['audio'] })
  map.setups[0]!.routing[`device:${me}`] = [{ from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones' } }]
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
  it('every cable is labelled with the signals its matrices route over it - and opening the map writes nothing', () => {
    setUp(false)
    render(<StageMap />)
    // Fire keeps its default routing; Redmi routes only the click, to its headphones.
    expect(screen.getAllByText('Klick · Track · Ansagen')).toHaveLength(1)
    expect(screen.getAllByText('Klick')).toHaveLength(1)
    expect(screen.getByText('an Fire')).toBeInTheDocument()
    expect(updateSetup).not.toHaveBeenCalled()
    expect(saveEquipment).not.toHaveBeenCalled()
  })

  it('full screen stays below dialogs - adding equipment opened hidden behind the map (2026-11-07)', () => {
    setUp(true)
    const { container } = render(<StageMap />)
    fireEvent.click(screen.getByRole('button', { name: 'Vollbild' }))
    const section = container.querySelector('section')!
    expect(section).toHaveClass('z-page')
    expect(section).not.toHaveClass('z-takeover')
  })

  it('panning sideways never switches the System tab (2026-11-07)', () => {
    setUp(false)
    const { container } = render(<StageMap />)
    expect(container.querySelector('section')).toHaveAttribute('data-no-tab-swipe')
  })

  it('the admin lists a mixer\'s ports freely: a mono-jack Aux group added, cables kept (2026-11-07)', async () => {
    setUp(true)
    render(<StageMap />)
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Pult')
    fireEvent.click(screen.getByRole('button', { name: 'Anschlüsse' }))
    expect(screen.getByRole('dialog', { name: 'Anschlüsse: Pult' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Anschluss hinzufügen' }))
    const names = screen.getAllByLabelText('Name')
    fireEvent.change(names[names.length - 1]!, { target: { value: 'Mono Out' } })
    const plugs = screen.getAllByLabelText('Stecker')
    fireEvent.change(plugs[plugs.length - 1]!, { target: { value: 'jack-6.3-ts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await vi.waitFor(() => expect(saveEquipment).toHaveBeenCalled())
    const saved = saveEquipment.mock.calls[0]![0] as { id: string; ports: { id: string; connector: string }[] }
    expect(saved.id).toBe('pult')
    expect(saved.ports.map((p) => p.id)).toEqual(['in', 'main', 'aux', 'mono-out'])
    expect(saved.ports[3]!.connector).toBe('jack-6.3-ts')
    // The cable on input 15 still fits - nothing on the map touched.
    expect(updateSetup).not.toHaveBeenCalled()
  })

  it('a stereo cable from Aux 1 of the desk into both inputs of the in-ear sender (2026-11-07)', async () => {
    setUp(true)
    const iem = equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'iem-sender')!, 'iem', 'IEM Kai')
    useStageMapStore.setState((s) => ({ equipment: [...s.equipment, iem], setups: s.setups.map((x) => ({ ...x, positions: { ...x.positions, iem: { x: 700, y: 900 } } })) }))
    render(
      <>
        <StageMap />
        <DialogHost />
      </>,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Pult')
    fireEvent.click(screen.getAllByRole('button', { name: 'Verbinden' }).find((b) => b.closest('li')?.textContent?.includes('Aux'))!)
    tapNode('IEM Kai')
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'Eingang 1' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }))
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'Stereo' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('radio', { name: 'Stereo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }))
    await vi.waitFor(() => expect(updateSetup).toHaveBeenCalled())
    const patch = updateSetup.mock.calls[0]![1] as (s: StageSetup) => StageSetup
    const links = patch(useStageMapStore.getState().setups[0]!).links
    const link = links[links.length - 1]
    expect(link).toMatchObject({ from: { equipmentId: 'pult', portId: 'aux', channel: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, width: 2 })
  })

  it('a placeholder tablet: added before it is registered, linked by the admin - the device the map added moves into it (2026-11-07)', async () => {
    setUp(true)
    const tablet = BUILTIN_MODELS.find((m) => m.id === 'tablet')!
    const placeholder = { ...equipmentFrom(tablet, 'ph', 'Kai geplant') }
    useStageMapStore.setState((s) => ({ equipment: [...s.equipment, placeholder], setups: s.setups.map((x) => ({ ...x, positions: { ...x.positions, ph: { x: 900, y: 600 } } })) }))
    const removeEquipment = vi.fn().mockResolvedValue(undefined)
    useStageMapStore.setState({ removeEquipment })
    render(
      <>
        <StageMap />
        <DialogHost />
      </>,
    )
    expect(screen.getByText('nicht registriert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Kai geplant')
    fireEvent.click(screen.getByRole('button', { name: 'Mit Gerät verbinden' }))
    // Fire is registered and was added to the map on its own.
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'Fire' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('radio', { name: 'Fire' }))
    const linkButtons = screen.getAllByRole('button', { name: 'Mit Gerät verbinden' })
    fireEvent.click(linkButtons[linkButtons.length - 1]!)
    await vi.waitFor(() => expect(removeEquipment).toHaveBeenCalledWith('device:fire'))
    expect(saveEquipment).toHaveBeenCalledWith(expect.objectContaining({ id: 'ph', deviceId: 'fire' }))
    expect(updateSetup).toHaveBeenCalled()
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

  it('a device shows its interfaces and its routing matrix; a tick in the mixer is written for this setup', () => {
    setUp(true)
    render(<StageMap />)
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Pult')
    expect(screen.getByRole('group', { name: 'Routing von Pult' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Eingang 15 → Aux 1' }))
    expect(updateSetup).toHaveBeenCalledTimes(1)
    const [, patch] = updateSetup.mock.calls[0]!
    const after = patch(useStageMapStore.getState().setups[0])
    expect(after.routing.pult).toEqual([{ from: { kind: 'port', portId: 'in', channel: 15 }, to: { kind: 'port', portId: 'aux', channel: 1 } }])
  })

  it('a cable: first its two ends and what runs on it, tapped again the whole way of each signal', () => {
    setUp(false)
    render(<StageMap />)
    tapNode('Redmi')
    fireEvent.click(screen.getByRole('button', { name: '→ Pult · Eingang 15' }))
    expect(screen.getByText('Redmi · Kopfhörer → Pult · Eingang 15')).toBeInTheDocument()
    expect(screen.queryByText(/kommt nirgends an/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Klick (Redmi)' }))
    expect(screen.getByText('kommt nirgends an')).toBeInTheDocument()
  })
})
