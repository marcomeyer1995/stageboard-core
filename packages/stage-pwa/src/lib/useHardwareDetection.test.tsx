import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { DeviceTransportConfig, LogicalDevice, PluginInstallation } from 'shared-types'

// This module transitively imports workspaceDb.ts, which constructs a real PouchDB at module
// load time - unavailable under happy-dom (see SystemView.test.tsx/workspaceDb.test.ts's
// identical mock).
const logicalDevicePut = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
    // useLogicalDevicesStore's real save() (workspaceCollection.ts's put()) now gets called by
    // bindDetectedDevice() too (writing the Logical Device's own executionTarget/pluginId
    // binding) - a bare rejection (treated as "doc doesn't exist yet") is all `get` needs to do;
    // `put` is a shared spy so tests can assert on what actually got written (the real store
    // doesn't reflect a `put()` back into its in-memory `devices` state without a live changes
    // feed, which this fake doesn't simulate).
    get() {
      return Promise.reject(new Error('not found'))
    }
    put(doc: unknown) {
      return logicalDevicePut(doc)
    }
  },
}))

// happy-dom has no WebMIDI/WebUSB at all, so the hook's real listeners would just no-op -
// mocked here to drive the "device connects before the stores finish loading" race
// (useHardwareDetection.test.ts's "replays" describe block below).
let midiConnectHandler: ((port: { id: string; name?: string; manufacturer?: string }) => void) | null = null
vi.mock('./webMidi', () => ({
  listenForMidiConnections: vi.fn((cb: (port: { id: string; name?: string; manufacturer?: string }) => void) => {
    midiConnectHandler = cb
    return Promise.resolve({ stop: vi.fn() })
  }),
}))
vi.mock('./webUsb', () => ({
  listenForUsbConnections: vi.fn(() => Promise.resolve(null)),
}))

const findMidiOutputIdByNamePattern = vi.hoisted(() => vi.fn().mockResolvedValue(null))
vi.mock('./webMidiOutput', () => ({ findMidiOutputIdByNamePattern }))

const reportDiscoveryCandidate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('./discoveryClient', () => ({ reportDiscoveryCandidate }))

const { getDeviceId } = await import('./deviceId')
const { getRememberedLogicalDeviceId } = await import('./hardwareDeviceMemory')
const { __resetHardwareDetectionForTests, handleDetected, useHardwareDetection } = await import('./useHardwareDetection')
const { useActiveSystemTabStore } = await import('../store/useActiveSystemTabStore')
const { useDeviceTransportConfigStore } = await import('../store/useDeviceTransportConfigStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { useDiscoverySessionStore } = await import('../store/useDiscoverySessionStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { usePluginsStore } = await import('../store/usePluginsStore')

const GENERIC_MIDI: PluginInstallation = {
  id: 'generic-webmidi',
  name: 'Generic WebMIDI Input',
  version: '0.0.1',
  runtime: 'client',
  capabilities: ['midi-input'],
  transports: [{ id: 'usb-midi', label: 'USB-MIDI', fields: [{ key: 'midiOutputId', label: 'MIDI-Ausgang', type: 'text' }] }],
  hardwareIds: [{ kind: 'webmidi' }],
  enabled: true,
  installedAt: 0,
}

const KEMPER_LOGICAL_DEVICE: LogicalDevice = {
  id: 'kemper-1',
  name: "Marco's Kemper",
  capability: 'midi-input',
  pluginId: null,
  executionTarget: null,
}

const KEMPER_PORT = { kind: 'webmidi' as const, portId: 'port-1', name: 'Kemper Profiler Emulator', manufacturer: '' }

let save: ReturnType<typeof vi.fn<(config: DeviceTransportConfig) => Promise<void>>>

beforeEach(() => {
  localStorage.clear()
  __resetHardwareDetectionForTests()
  midiConnectHandler = null
  findMidiOutputIdByNamePattern.mockReset().mockResolvedValue(null)
  reportDiscoveryCandidate.mockReset().mockResolvedValue(undefined)
  logicalDevicePut.mockReset().mockResolvedValue(undefined)
  save = vi.fn(async () => {})
  usePluginsStore.setState({ installed: [GENERIC_MIDI], loaded: true })
  useLogicalDevicesStore.setState({ devices: [KEMPER_LOGICAL_DEVICE], loaded: true })
  useDeviceTransportConfigStore.setState({ configs: [], loaded: true, save })
  useDialogStore.setState({ request: null })
  useDiscoverySessionStore.setState({ workspaceId: '', session: { active: false, startedAt: null, startedBy: null, candidates: [], identifying: null } })
  // Every existing test below exercises the "ask a human" paths (alert/prompt), which are now
  // gated on System → Hardware being the active tab (2026-09-08, Marco's explicit safety
  // request) - default to on-tab here so those tests keep covering their original behavior; the
  // gate itself is covered by its own describe block below.
  useActiveSystemTabStore.setState({ activeTab: 'hardware' })
})

describe('handleDetected', () => {
  it('no-ops while the workspace-scoped stores are not loaded yet', async () => {
    usePluginsStore.setState({ loaded: false })
    await handleDetected(KEMPER_PORT)
    expect(save).not.toHaveBeenCalled()
    expect(useDialogStore.getState().request).toBeNull()
  })

  it('ignores a device that matches no installed plugin', async () => {
    usePluginsStore.setState({ installed: [] })
    await handleDetected(KEMPER_PORT)
    expect(save).not.toHaveBeenCalled()
    expect(useDialogStore.getState().request).toBeNull()
  })

  it('alerts instead of prompting when no Logical Device provides the matched capability', async () => {
    useLogicalDevicesStore.setState({ devices: [] })
    const promise = handleDetected(KEMPER_PORT)
    expect(useDialogStore.getState().request?.kind).toBe('alert')
    useDialogStore.getState().acceptAlert()
    await promise
    expect(save).not.toHaveBeenCalled()
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBeNull()
  })

  it('prompts for a role, saves the DeviceTransportConfig with the port id prefilled, and remembers the choice', async () => {
    const promise = handleDetected(KEMPER_PORT)
    const request = useDialogStore.getState().request
    expect(request?.kind).toBe('prompt')
    if (request?.kind !== 'prompt') throw new Error('expected a prompt request')
    expect(request.fields[0].options).toEqual([{ value: 'kemper-1', label: "Marco's Kemper" }])

    useDialogStore.getState().submit({ logicalDeviceId: 'kemper-1' })
    await promise

    expect(save).toHaveBeenCalledTimes(1)
    const config = save.mock.calls[0][0] as DeviceTransportConfig
    expect(config).toMatchObject({
      deviceId: getDeviceId(),
      logicalDeviceId: 'kemper-1',
      transportId: 'usb-midi',
      values: { midiOutputId: 'port-1' },
    })
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBe('kemper-1')

    // Now that #10's per-Setup binding lives directly on the Logical Device, binding it also
    // has to fill in *its* pluginId/executionTarget - not just this device's own transport
    // config - or a freshly-bound device would show up everywhere else as still-unbound.
    expect(logicalDevicePut).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'kemper-1', pluginId: 'generic-webmidi', executionTarget: getDeviceId() }),
    )
  })

  it('resolves midiOutputId via the plugin\'s namePattern (input-port id is wrong for sending), not the detected input port id', async () => {
    // Regression: confirmed live against a real browser + Kemper Profiler emulator
    // (~/Device Emulators) - a device-specific plugin needs the real MIDIOutput port id to
    // actually send anything; detected.portId is an *input*-port id (this hook only observes
    // access.inputs), which access.outputs.get() never finds.
    const KEMPER_PLUGIN: PluginInstallation = {
      ...GENERIC_MIDI,
      id: 'kemper-profiler',
      name: 'Kemper Profiler',
      capabilities: ['kemper-control'],
      hardwareIds: [{ kind: 'webmidi', namePattern: 'Kemper' }],
    }
    const KEMPER_ROLE: LogicalDevice = {
      id: 'kemper-role',
      name: "Marco's Kemper",
      capability: 'kemper-control',
      pluginId: null,
      executionTarget: null,
    }
    usePluginsStore.setState({ installed: [KEMPER_PLUGIN] })
    useLogicalDevicesStore.setState({ devices: [KEMPER_ROLE] })
    findMidiOutputIdByNamePattern.mockResolvedValue('real-output-id')

    const promise = handleDetected(KEMPER_PORT)
    useDialogStore.getState().submit({ logicalDeviceId: 'kemper-role' })
    await promise

    expect(findMidiOutputIdByNamePattern).toHaveBeenCalledWith('Kemper')
    expect(save.mock.calls[0][0]).toMatchObject({ values: { midiOutputId: 'real-output-id' } })
  })

  it('falls back to the input port id when no matching MIDIOutput exists yet', async () => {
    const KEMPER_PLUGIN: PluginInstallation = {
      ...GENERIC_MIDI,
      id: 'kemper-profiler',
      capabilities: ['kemper-control'],
      hardwareIds: [{ kind: 'webmidi', namePattern: 'Kemper' }],
    }
    const KEMPER_ROLE: LogicalDevice = {
      id: 'kemper-role',
      name: "Marco's Kemper",
      capability: 'kemper-control',
      pluginId: null,
      executionTarget: null,
    }
    usePluginsStore.setState({ installed: [KEMPER_PLUGIN] })
    useLogicalDevicesStore.setState({ devices: [KEMPER_ROLE] })
    findMidiOutputIdByNamePattern.mockResolvedValue(null)

    const promise = handleDetected(KEMPER_PORT)
    useDialogStore.getState().submit({ logicalDeviceId: 'kemper-role' })
    await promise

    expect(save.mock.calls[0][0]).toMatchObject({ values: { midiOutputId: 'port-1' } })
  })

  it('does nothing when the role prompt is cancelled', async () => {
    const promise = handleDetected(KEMPER_PORT)
    useDialogStore.getState().cancel()
    await promise
    expect(save).not.toHaveBeenCalled()
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBeNull()
  })

  it('silently re-binds a remembered device without showing any dialog', async () => {
    const firstConnect = handleDetected(KEMPER_PORT)
    useDialogStore.getState().submit({ logicalDeviceId: 'kemper-1' })
    await firstConnect
    save.mockClear()

    await handleDetected(KEMPER_PORT)

    expect(useDialogStore.getState().request).toBeNull()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0]).toMatchObject({ logicalDeviceId: 'kemper-1' })
  })
})

describe('handleDetected - the "ask a human" popups are gated to System → Hardware (Marco, explicit safety request, 2026-09-08)', () => {
  it('silently drops a never-before-seen device instead of prompting, off the Hardware tab', async () => {
    useActiveSystemTabStore.setState({ activeTab: 'band' })
    await handleDetected(KEMPER_PORT)
    expect(useDialogStore.getState().request).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('silently drops it when SystemView is not mounted at all (activeTab null)', async () => {
    useActiveSystemTabStore.setState({ activeTab: null })
    await handleDetected(KEMPER_PORT)
    expect(useDialogStore.getState().request).toBeNull()
  })

  it('also drops the "no matching role" alert, not just the role-picker prompt', async () => {
    useLogicalDevicesStore.setState({ devices: [] })
    useActiveSystemTabStore.setState({ activeTab: 'plugins' })
    await handleDetected(KEMPER_PORT)
    expect(useDialogStore.getState().request).toBeNull()
  })

  it('does not affect the silent remembered-device rebind, which never asked anything to begin with', async () => {
    useActiveSystemTabStore.setState({ activeTab: 'hardware' })
    const firstConnect = handleDetected(KEMPER_PORT)
    useDialogStore.getState().submit({ logicalDeviceId: 'kemper-1' })
    await firstConnect
    save.mockClear()

    useActiveSystemTabStore.setState({ activeTab: 'band' }) // now off the Hardware tab
    await handleDetected(KEMPER_PORT)

    expect(useDialogStore.getState().request).toBeNull()
    expect(save).toHaveBeenCalledTimes(1) // still silently re-binds
  })
})

describe('handleDetected - defers to an active Discovery Mode session', () => {
  beforeEach(() => {
    useDiscoverySessionStore.setState({
      workspaceId: 'band-a',
      session: { active: true, startedAt: 1, startedBy: 'marco', candidates: [], identifying: null },
    })
  })

  it('reports the candidate to the session instead of prompting locally', async () => {
    await handleDetected(KEMPER_PORT)

    expect(reportDiscoveryCandidate).toHaveBeenCalledWith('band-a', getDeviceId(), KEMPER_PORT)
    expect(useDialogStore.getState().request).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })

  it('does not touch Auto-Memory or write any config itself', async () => {
    await handleDetected(KEMPER_PORT)
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBeNull()
  })
})

function Detector() {
  useHardwareDetection()
  return null
}

describe('useHardwareDetection (hook)', () => {
  it('replays a device seen before the workspace-scoped stores finished loading, once they load', async () => {
    // The real-world race this regression-tests: WebMIDI's connect event for an
    // already-plugged-in device fires as soon as requestMIDIAccess() resolves, typically well
    // before the stores' own async CouchDB load finishes - confirmed live against a real
    // browser + Kemper Profiler emulator (~/Device Emulators), where an early build of this
    // hook silently dropped the device forever because no further "connect" event was coming.
    usePluginsStore.setState({ installed: [], loaded: false })
    useLogicalDevicesStore.setState({ devices: [], loaded: false })
    useDeviceTransportConfigStore.setState({ loaded: false })

    render(<Detector />)
    await Promise.resolve()
    await Promise.resolve()
    expect(midiConnectHandler).not.toBeNull()

    midiConnectHandler!({ id: 'port-1', name: 'Kemper Profiler Emulator', manufacturer: '' })
    await Promise.resolve()
    expect(useDialogStore.getState().request).toBeNull() // Stores not loaded yet - no prompt.

    usePluginsStore.setState({ installed: [GENERIC_MIDI], loaded: true })
    useLogicalDevicesStore.setState({ devices: [KEMPER_LOGICAL_DEVICE], loaded: true })
    useDeviceTransportConfigStore.setState({ loaded: true })
    await Promise.resolve()
    await Promise.resolve()

    const request = useDialogStore.getState().request
    expect(request?.kind).toBe('prompt')
    if (request?.kind !== 'prompt') throw new Error('expected a prompt request')
    expect(request.title).toBe('Neues Gerät: Kemper Profiler Emulator')
  })

  it('replays an already-connected device into Discovery Mode once the admin starts a session', async () => {
    render(<Detector />)
    await Promise.resolve()
    await Promise.resolve()

    midiConnectHandler!({ id: 'port-1', name: 'Kemper Profiler Emulator', manufacturer: '' })
    await Promise.resolve()
    expect(reportDiscoveryCandidate).not.toHaveBeenCalled() // no session yet - the usual #106 flow handled it

    useDiscoverySessionStore.setState({
      workspaceId: 'band-a',
      session: { active: true, startedAt: 1, startedBy: 'marco', candidates: [], identifying: null },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(reportDiscoveryCandidate).toHaveBeenCalledWith('band-a', getDeviceId(), {
      kind: 'webmidi',
      portId: 'port-1',
      name: 'Kemper Profiler Emulator',
      manufacturer: '',
    })
  })
})

describe('useHardwareDetection (hook) - resolveDiscoveryWins', () => {
  const KEMPER_PLUGIN: PluginInstallation = {
    ...GENERIC_MIDI,
    id: 'kemper-profiler',
    name: 'Kemper Profiler',
    capabilities: ['kemper-control'],
    hardwareIds: [{ kind: 'webmidi', namePattern: 'Kemper' }],
  }

  it('writes this tablet\'s own DeviceTransportConfig once one of its candidates is marked assigned', async () => {
    usePluginsStore.setState({ installed: [KEMPER_PLUGIN] })
    render(<Detector />)
    await Promise.resolve()

    useDiscoverySessionStore.setState({
      workspaceId: 'band-a',
      session: {
        active: true,
        startedAt: 1,
        startedBy: 'marco',
        identifying: null,
        candidates: [
          {
            reporterId: getDeviceId(),
            hardwareKey: 'webmidi:port-1',
            name: 'Kemper Profiler Emulator',
            manufacturer: '',
            matchedPluginId: 'kemper-profiler',
            status: 'assigned',
            assignedLogicalDeviceId: 'marcos-kemper',
          },
        ],
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(save).toHaveBeenCalledTimes(1)
    const config = save.mock.calls[0][0] as DeviceTransportConfig
    expect(config).toMatchObject({ deviceId: getDeviceId(), logicalDeviceId: 'marcos-kemper', transportId: 'usb-midi' })
    expect(getRememberedLogicalDeviceId('webmidi:port-1')).toBe('marcos-kemper')
  })

  it('ignores an assigned candidate that belongs to a different reporter (another tablet, or the server)', async () => {
    usePluginsStore.setState({ installed: [KEMPER_PLUGIN] })
    render(<Detector />)
    await Promise.resolve()

    useDiscoverySessionStore.setState({
      workspaceId: 'band-a',
      session: {
        active: true,
        startedAt: 1,
        startedBy: 'marco',
        identifying: null,
        candidates: [
          {
            reporterId: 'some-other-tablet',
            hardwareKey: 'webmidi:port-1',
            name: 'Kemper Profiler Emulator',
            manufacturer: '',
            matchedPluginId: 'kemper-profiler',
            status: 'assigned',
            assignedLogicalDeviceId: 'marcos-kemper',
          },
        ],
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(save).not.toHaveBeenCalled()
  })

  it('writes a won role only once, even across repeated session updates', async () => {
    usePluginsStore.setState({ installed: [KEMPER_PLUGIN] })
    render(<Detector />)
    await Promise.resolve()

    const won = {
      active: true,
      startedAt: 1,
      startedBy: 'marco',
      identifying: null,
      candidates: [
        {
          reporterId: getDeviceId(),
          hardwareKey: 'webmidi:port-1',
          name: 'Kemper Profiler Emulator',
          manufacturer: '',
          matchedPluginId: 'kemper-profiler',
          status: 'assigned' as const,
          assignedLogicalDeviceId: 'marcos-kemper',
        },
      ],
    }
    useDiscoverySessionStore.setState({ workspaceId: 'band-a', session: won })
    await Promise.resolve()
    await Promise.resolve()
    useDiscoverySessionStore.setState({ workspaceId: 'band-a', session: { ...won } })
    await Promise.resolve()
    await Promise.resolve()

    expect(save).toHaveBeenCalledTimes(1)
  })
})
