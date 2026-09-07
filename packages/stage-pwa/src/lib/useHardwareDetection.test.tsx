import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import type { DeviceTransportConfig, LogicalDevice, PluginInstallation } from 'shared-types'

// This module transitively imports workspaceDb.ts, which constructs a real PouchDB at module
// load time - unavailable under happy-dom (see SystemView.test.tsx/workspaceDb.test.ts's
// identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
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

const { getDeviceId } = await import('./deviceId')
const { getRememberedLogicalDeviceId } = await import('./hardwareDeviceMemory')
const { handleDetected, useHardwareDetection } = await import('./useHardwareDetection')
const { useDeviceTransportConfigStore } = await import('../store/useDeviceTransportConfigStore')
const { useDialogStore } = await import('../store/useDialogStore')
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

const KEMPER_LOGICAL_DEVICE: LogicalDevice = { id: 'kemper-1', name: "Marco's Kemper", capability: 'midi-input' }

const KEMPER_PORT = { kind: 'webmidi' as const, portId: 'port-1', name: 'Kemper Profiler Emulator', manufacturer: '' }

let save: ReturnType<typeof vi.fn<(config: DeviceTransportConfig) => Promise<void>>>

beforeEach(() => {
  localStorage.clear()
  midiConnectHandler = null
  findMidiOutputIdByNamePattern.mockReset().mockResolvedValue(null)
  save = vi.fn(async () => {})
  usePluginsStore.setState({ installed: [GENERIC_MIDI], loaded: true })
  useLogicalDevicesStore.setState({ devices: [KEMPER_LOGICAL_DEVICE], loaded: true })
  useDeviceTransportConfigStore.setState({ configs: [], loaded: true, save })
  useDialogStore.setState({ request: null })
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
    const KEMPER_ROLE: LogicalDevice = { id: 'kemper-role', name: "Marco's Kemper", capability: 'kemper-control' }
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
    const KEMPER_ROLE: LogicalDevice = { id: 'kemper-role', name: "Marco's Kemper", capability: 'kemper-control' }
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
})
