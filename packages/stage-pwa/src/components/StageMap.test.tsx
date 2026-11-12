import { fireEvent, render, screen, within } from '@testing-library/react'
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

// The MIDI ports this tablet sees (WebMIDI isn't in happy-dom).
vi.mock('../lib/webMidiOutput', async (importOriginal) => ({ ...(await importOriginal<object>()), listMidiOutputs: async () => [{ id: 'k1', name: 'Kemper Player' }] }))

// What the devices report to the Stage-Server (the map's "Prüfen", #747).
const reported = { devices: {} as Record<string, unknown> }
vi.mock('../lib/fetchDeviceInfo', () => ({ fetchDeviceInfo: async () => ({ devices: { ...reported.devices } }) }))

const { getDeviceId } = await import('../lib/deviceId')
const { useDevicesStore } = await import('../store/useDevicesStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useActiveProfileStore } = await import('../store/useActiveProfileStore')
const { useProfilesStore } = await import('../store/useProfilesStore')
const { usePresenceStore } = await import('../store/usePresenceStore')
const { useStageMapStore } = await import('../store/useStageMapStore')
const { StageMap } = await import('./StageMap')
const { wheelZoomFactor } = await import('../lib/wheelZoom')
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
  useStageMapStore.setState({ ...map, ownSetups: [], ownEquipment: [], loaded: true, updateSetup, saveEquipment })
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
  it('zooms in proportion to the wheel: a mouse notch ~15 %, a touchpad\'s small steps gently (2026-11-07)', () => {
    expect(wheelZoomFactor(100)).toBeCloseTo(1.15, 2)
    expect(wheelZoomFactor(-100)).toBeCloseTo(1 / 1.15, 2)
    expect(wheelZoomFactor(4)).toBeCloseTo(1.0056, 3)
    // A line-mode wheel (Firefox) counts like pixels; one event is capped.
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48), 5)
    expect(wheelZoomFactor(5000)).toBe(wheelZoomFactor(100))
  })


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

  it('MIDI from this tablet\'s USB to the Kemper: the port is picked from what this tablet sees and kept on the cable (part 2, 2026-11-07)', async () => {
    setUp(true)
    const kemper = equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'amp-modeller')!, 'kemper', 'Kemper')
    useStageMapStore.setState((s) => ({ equipment: [...s.equipment, kemper], setups: s.setups.map((x) => ({ ...x, positions: { ...x.positions, kemper: { x: 900, y: 900 } } })) }))
    render(
      <>
        <StageMap />
        <DialogHost />
      </>,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Redmi')
    fireEvent.click(screen.getAllByRole('button', { name: 'Verbinden' }).find((b) => b.closest('li')?.textContent?.includes('USB-C'))!)
    tapNode('Kemper')
    // The Kemper takes MIDI on USB and on its DIN socket: USB.
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'USB' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('radio', { name: 'USB' }))
    fireEvent.click(screen.getByRole('button', { name: 'Verbinden' }))
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'Kemper Player' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('radio', { name: 'Kemper Player' }))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await vi.waitFor(() => expect(updateSetup).toHaveBeenCalledTimes(2))
    // The cable first, then its MIDI port on it.
    const [addCable, setName] = updateSetup.mock.calls.map((c) => c[1] as (s: StageSetup) => StageSetup)
    const links = setName!(addCable!(useStageMapStore.getState().setups[0]!)).links
    expect(links[links.length - 1]).toMatchObject({ from: { portId: 'usb' }, to: { equipmentId: 'kemper', portId: 'usb' }, midiName: 'Kemper Player' })
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

  it('the Dev app is the same device as the release app: one box, both apps listed, the extra one can be separated (2026-11-07)', async () => {
    setUp(true)
    const removeEquipment = vi.fn().mockResolvedValue(undefined)
    useStageMapStore.setState({ removeEquipment })
    render(
      <>
        <StageMap />
        <DialogHost />
      </>,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Fire')
    fireEvent.click(screen.getByRole('button', { name: 'Dasselbe Gerät wie …' }))
    await vi.waitFor(() => expect(screen.getByRole('radio', { name: 'Redmi' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('radio', { name: 'Redmi' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zusammenführen' }))
    await vi.waitFor(() => expect(removeEquipment).toHaveBeenCalledWith('device:fire'))
    expect(saveEquipment).toHaveBeenCalledWith(expect.objectContaining({ id: `device:${me}`, appIds: ['fire'] }))
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
    // Groups are closed until opened (#744): the inputs as a column, the Aux outs as a row.
    expect(screen.getByRole('switch', { name: 'Eingang · 0/16 → Aux · 0/4' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Eingang: auf- oder zuklappen' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Aux: auf- oder zuklappen' })[0]!)
    fireEvent.click(screen.getByRole('switch', { name: 'Eingang 15 → Aux 1' }))
    expect(updateSetup).toHaveBeenCalledTimes(1)
    const [, patch] = updateSetup.mock.calls[0]!
    const after = patch(useStageMapStore.getState().setups[0])
    expect(after.routing.pult).toEqual([{ from: { kind: 'port', portId: 'in', channel: 15 }, to: { kind: 'port', portId: 'aux', channel: 1 } }])
  })

  it("a USB interface on this tablet's USB-C: the matrix shows 'USB-C · Audio aus 1-4' from the interface's count, and the headphone jack its L and R (#739)", () => {
    setUp(true)
    const base = BUILTIN_MODELS.find((m) => m.id === 'audio-interface')!
    const umc = equipmentFrom({ ...base, ports: base.ports.map((p) => (p.id === 'usb' ? { ...p, parts: p.parts!.map((x) => (x.id === 'usb/audio-in' ? { ...x, channels: 4 } : x)) } : p)) }, 'umc', 'UMC204HD')
    useStageMapStore.setState((s) => ({
      equipment: [...s.equipment, umc],
      setups: s.setups.map((x) => ({ ...x, positions: { ...x.positions, umc: { x: 900, y: 900 } }, links: [...x.links, { id: 'usb', from: { equipmentId: `device:${me}`, portId: 'usb' }, to: { equipmentId: 'umc', portId: 'usb' }, signals: ['usb-audio', 'midi'] }] })),
    }))
    render(<StageMap />)
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Redmi')
    // Smart matrix (#744): the stereo track dropped on the closed USB audio group takes channels 1 and 2.
    fireEvent.click(screen.getByRole('switch', { name: 'Track → USB-C · Audio aus · 0/4' }))
    expect(updateSetup).toHaveBeenCalledTimes(2)
    const routedTo = (call: number) => updateSetup.mock.calls[call]![1](useStageMapStore.getState().setups[0]).routing[`device:${me}`]
    expect(routedTo(0)).toContainEqual({ from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'usb/audio-out', channel: 1 } })
    expect(routedTo(1)).toContainEqual({ from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'usb/audio-out', channel: 2 } })
    // Opened, the single channels are there - four of them, from the interface's count.
    fireEvent.click(screen.getAllByRole('button', { name: 'USB-C · Audio aus: auf- oder zuklappen' })[0]!)
    fireEvent.click(screen.getByRole('switch', { name: 'Track → USB-C · Audio aus 3' }))
    expect(routedTo(2)).toContainEqual({ from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'usb/audio-out', channel: 3 } })
    expect(screen.queryByRole('switch', { name: 'Track → USB-C · Audio aus 5' })).toBeNull()
    // The headphone jack closed is the whole socket (as before); opened it offers L and R.
    // The whole socket counts as both pins taken.
    fireEvent.click(screen.getByRole('switch', { name: 'Klick → Kopfhörer · 2/2' }))
    expect(routedTo(3)).not.toContainEqual({ from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Kopfhörer: auf- oder zuklappen' })[0]!)
    fireEvent.click(screen.getByRole('switch', { name: 'Klick → Kopfhörer L' }))
    expect(routedTo(4)).toContainEqual({ from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones', pin: 1 } })
  })

  it('the track opens into its sides (2026-11-12): "Track L" on the right pin; the whole track on channels 1 and 2 shows L and R', () => {
    setUp(true)
    useStageMapStore.setState((s) => ({
      setups: s.setups.map((x) => ({
        ...x,
        routing: {
          ...x.routing,
          [`device:${me}`]: [
            { from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'headphones', pin: 1 } },
            { from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'headphones', pin: 2 } },
          ],
        },
      })),
    }))
    render(<StageMap />)
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Redmi')
    const matrix = screen.getByRole('group', { name: 'Routing von Redmi' })
    fireEvent.click(within(matrix).getAllByRole('button', { name: 'Kopfhörer: auf- oder zuklappen' })[0]!)
    // Left on L, right on R - said in the cells.
    expect(within(matrix).getAllByText('L', { selector: 'text' })).toHaveLength(1)
    expect(within(matrix).getAllByText('R', { selector: 'text' })).toHaveLength(1)
    fireEvent.click(within(matrix).getByRole('button', { name: 'Track: auf- oder zuklappen' }))
    fireEvent.click(within(matrix).getByRole('switch', { name: 'Track L → Kopfhörer R' }))
    const routedTo = updateSetup.mock.calls[0]![1](useStageMapStore.getState().setups[0]).routing[`device:${me}`]
    expect(routedTo).toContainEqual({ from: { kind: 'virtual', virtualPortId: 'track', channel: 1 }, to: { kind: 'port', portId: 'headphones', pin: 2 } })
    expect(within(matrix).getByRole('switch', { name: 'Track (beide Seiten) → Kopfhörer L' })).toHaveAttribute('aria-checked', 'true')
  })

  it('an interface does not mix: a second signal on a taken output asks "replace?" - and the cable list names what is wrong (#746)', async () => {
    setUp(true)
    const umc = equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'audio-interface')!, 'umc', 'UMC204HD')
    useStageMapStore.setState((s) => ({ equipment: [...s.equipment, umc], setups: s.setups.map((x) => ({ ...x, positions: { ...x.positions, umc: { x: 900, y: 900 } } })) }))
    render(
      <>
        <StageMap />
        <DialogHost />
      </>,
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('UMC204HD')
    fireEvent.click(screen.getAllByRole('button', { name: 'USB · Audio ein (vom Host): auf- oder zuklappen' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Ausgang: auf- oder zuklappen' })[0]!)
    // Output 1 already carries "Audio ein 1" (the model's default).
    fireEvent.click(screen.getByRole('switch', { name: /Audio ein \(vom Host\) 2 → Ausgang 1$/ }))
    expect(updateSetup).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(screen.getByRole('alertdialog', { name: 'Ausgang ist belegt' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Ersetzen' }))
    await vi.waitFor(() => expect(updateSetup).toHaveBeenCalledTimes(1))
    const after = (updateSetup.mock.calls[0]![1] as (s: StageSetup) => StageSetup)(useStageMapStore.getState().setups[0]!)
    expect(after.routing.umc!.filter((c) => c.to.kind === 'port' && c.to.channel === 1)).toEqual([{ from: { kind: 'port', portId: 'usb/audio-in', channel: 2 }, to: { kind: 'port', portId: 'out', channel: 1 } }])
    // Both on the output anyway (an older map): the cable list says so, naming device and port.
    useStageMapStore.setState((s) => ({
      setups: s.setups.map((x) => ({ ...x, routing: { ...x.routing, umc: [1, 2].map((channel) => ({ from: { kind: 'port' as const, portId: 'usb/audio-in', channel }, to: { kind: 'port' as const, portId: 'out', channel: 1 } })) } })),
    }))
    fireEvent.click(screen.getByRole('button', { name: /Verkabelung \(/ }))
    expect(screen.getByText(/^UMC204HD · Ausgang 1: 2 Signale auf demselben Ausgang, aber UMC204HD mischt nicht/)).toBeInTheDocument()
  })

  it('hum loops (#748): "Strom" per device, the cable list warns, an isolator on the cable clears it', async () => {
    setUp(true)
    render(<StageMap />)
    fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
    tapNode('Pult')
    expect(screen.getByRole('radio', { name: 'Geerdet (Schuko)' })).toHaveAttribute('aria-checked', 'true')
    tapNode('Redmi')
    expect(screen.getByRole('radio', { name: 'Akku' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Geerdet (Schuko)' }))
    await vi.waitFor(() => expect(saveEquipment).toHaveBeenCalledWith(expect.objectContaining({ name: 'Redmi', earth: 'earthed' })))
    // The Redmi on an earthed charger, its headphone jack into the earthed desk: a loop.
    useStageMapStore.setState((s) => ({ equipment: s.equipment.map((e) => (e.name === 'Redmi' ? { ...e, earth: 'earthed' as const } : e)) }))
    fireEvent.click(screen.getByRole('button', { name: /Verkabelung \(/ }))
    expect(screen.getByText(/^Brummschleife wahrscheinlich: Redmi und Pult sind beide geerdet/)).toBeInTheDocument()
    // On the cable: by its plugs unbalanced; "Mit Trenner" is written to the cable.
    fireEvent.click(screen.getByRole('button', { name: '→ Pult · Eingang 15' }))
    expect(screen.getByText('Nach den Steckern: Unsymmetrisch')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Mit Trenner' }))
    await vi.waitFor(() => expect(updateSetup).toHaveBeenCalled())
    const after = (updateSetup.mock.calls[updateSetup.mock.calls.length - 1]![1] as (s: StageSetup) => StageSetup)(useStageMapStore.getState().setups[0]!)
    expect(after.links.find((l) => l.id === 'cable')!.ground).toBe('isolated')
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

  describe('own setups (#799, docs/31 §0d)', () => {
    const home = (owner: string, name: string): StageSetup => ({ id: `home-${owner}`, name, owner, positions: { [`device:${me}`]: { x: 0, y: 0 } }, links: [], routing: {} })

    it('a member starts an own setup from their own device - the band\'s setup stays as it is', async () => {
      setUp(false)
      const saveSetup = vi.fn().mockResolvedValue(undefined)
      useStageMapStore.setState({ saveSetup })
      render(
        <>
          <StageMap />
          <DialogHost />
        </>,
      )
      fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
      fireEvent.click(screen.getByRole('button', { name: /Mein Aufbau \(neu\)/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Hinzufügen' }))
      await vi.waitFor(() => expect(saveSetup).toHaveBeenCalled())
      const own = saveSetup.mock.calls[0]![0] as StageSetup
      expect(own).toMatchObject({ name: 'Zuhause', owner: 'p-marco' })
      expect(Object.keys(own.positions)).toContain(`device:${me}`)
      expect(Object.keys(own.positions)).not.toContain('device:fire')
      expect(Object.keys(own.positions)).not.toContain('pult')
      expect(updateSetup).not.toHaveBeenCalled()
    })

    it('is listed for its owner and the admin, not for the other members', () => {
      setUp(false)
      useStageMapStore.setState({ ownSetups: [home('p-kai', 'Keller')] })
      const member = render(<StageMap />)
      expect(screen.queryByText(/Keller/)).toBeNull()
      member.unmount()

      setUp(true)
      useStageMapStore.setState({ ownSetups: [home('p-kai', 'Keller')] })
      const admin = render(<StageMap />)
      expect(screen.getByRole('radio', { name: 'Keller (Kai)' })).toBeInTheDocument()
      admin.unmount()

      setUp(false)
      useStageMapStore.setState({ ownSetups: [home('p-marco', 'Zuhause')] })
      render(<StageMap />)
      fireEvent.click(screen.getByRole('radio', { name: 'Mein: Zuhause' }))
      expect(screen.getByText(/nur du und der Admin sehen ihn/)).toBeInTheDocument()
    })

    it('own equipment is offered in its owner\'s setup only, and what is added there is theirs', async () => {
      setUp(false)
      const unit = { ...equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'mixer')!, 'unit', 'Effektgerät'), owner: 'p-marco' }
      useStageMapStore.setState({ ownSetups: [home('p-marco', 'Zuhause')], ownEquipment: [unit] })
      render(
        <>
          <StageMap />
          <DialogHost />
        </>,
      )
      fireEvent.click(screen.getByRole('switch', { name: 'Bearbeiten' }))
      // The band's setup: a member neither adds equipment nor sees the own unit.
      expect(screen.queryByRole('button', { name: /Effektgerät/ })).toBeNull()
      expect(screen.queryByRole('button', { name: /Ausrüstung hinzufügen/ })).toBeNull()
      fireEvent.click(screen.getByRole('radio', { name: 'Mein: Zuhause' }))
      expect(screen.getByRole('button', { name: /Effektgerät/ })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Ausrüstung hinzufügen/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Hinzufügen' }))
      await vi.waitFor(() => expect(saveEquipment).toHaveBeenCalled())
      expect(saveEquipment.mock.calls[0]![0]).toMatchObject({ owner: 'p-marco' })
    })
  })

  it('"Prüfen" shows what each device reports: an offline tablet is red, on the map and in the list, and editing is off (#747)', async () => {
    setUp(true)
    const { getServerTime } = await import('../lib/clockSync')
    reported.devices = { [me]: { ip: '10.0.0.2', os: 'Android', environment: 'native', syncStatus: 'idle', lastSeenAt: getServerTime(), networkReachable: true, hostname: null, battery: { pct: 64, charging: false } } }
    const { container } = render(<StageMap />)
    expect(container.querySelector('circle[data-live]')).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: 'Prüfen' }))
    await vi.waitFor(() => expect(screen.getByText('Fehler: 1')).toBeInTheDocument())
    expect(screen.getByText(/App offen/)).toBeInTheDocument()
    expect(screen.getByText(/Akku 64 %/)).toBeInTheDocument()
    expect(screen.getByText(/offline/)).toBeInTheDocument()
    expect([...container.querySelectorAll('circle[data-live]')].map((c) => c.getAttribute('data-live')).sort()).toEqual(['error', 'ok'])
    expect(screen.queryByRole('switch', { name: 'Bearbeiten' })).toBeNull()

    // Back to "Aufbau": the layer is gone.
    fireEvent.click(screen.getByRole('radio', { name: 'Aufbau' }))
    expect(container.querySelector('circle[data-live]')).toBeNull()
    expect(screen.queryByText('Fehler: 1')).toBeNull()
  })
})
