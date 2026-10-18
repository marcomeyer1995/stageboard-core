import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { LogicalDevice, PluginInstallation } from 'shared-types'
import type { CustomTriggerConfig } from './customTriggerConfig'

const localMixerApplyEvent = vi.fn()
vi.mock('../store/useLocalMixerStore', () => ({
  useLocalMixerStore: { getState: () => ({ applyEvent: localMixerApplyEvent }) },
}))
vi.mock('../store/useLocalLightingStore', () => ({
  useLocalLightingStore: { getState: () => ({ applyEvent: vi.fn() }) },
}))

const triggerShowControl = vi.hoisted(() => vi.fn(async () => ({ status: 'ok' })))
vi.mock('../lib/showControlClient', () => ({ triggerShowControl }))
const triggerDeviceControl = vi.hoisted(() => vi.fn(async () => ({ status: 'ok' })))
vi.mock('../lib/deviceControlClient', () => ({ triggerDeviceControl }))

// clientTranslator.ts transitively imports workspaceDb.ts (kemperTranslator.ts etc.), which
// constructs a real PouchDB at module load time - unavailable under happy-dom (see
// cueFiring.test.ts's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const show = vi.hoisted(() => ({ canControl: true, playbackStatus: 'stopped', elapsedMs: null, queue: {}, next: vi.fn(async () => {}) }))
vi.mock('../lib/showMode', () => ({ useShowMode: () => show }))

const { usePluginsStore } = await import('../store/usePluginsStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { CustomTriggerWidget, CustomTriggerConfigPanel } = await import('./CustomTriggerWidget')
const { useSwitchesStore } = await import('../store/useSwitchesStore')

function device(overrides: Partial<LogicalDevice> & Pick<LogicalDevice, 'id' | 'name'>): LogicalDevice {
  return { capability: 'mixer', pluginId: null, executionTarget: null, ...overrides }
}

function plugin(overrides: Partial<PluginInstallation> = {}): PluginInstallation {
  return {
    id: 'mock-mixer',
    name: 'Mock Mixer',
    version: '0.0.1',
    runtime: 'both',
    capabilities: ['mixer'],
    transports: [],
    hardwareIds: [],
    enabled: true,
    installedAt: 0,
    ...overrides,
  }
}

function config(overrides: Partial<CustomTriggerConfig> = {}): CustomTriggerConfig {
  return {
    label: 'Strobe',
    color: 'accent',
    behavior: 'momentary',
    commandType: 'strobe',
    commandPayloadJson: '{}',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  show.canControl = true
  usePluginsStore.setState({ installed: [], health: { plugins: {} } })
  useLogicalDevicesStore.setState({ devices: [] })
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
})

describe('CustomTriggerWidget', () => {
  it('disables the button when no target device is configured', () => {
    render(<CustomTriggerWidget config={config()} />)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText('Keine Aktion gewählt')).toBeInTheDocument()
  })

  it('momentary: fires active=true on press and active=false on release', async () => {
    const mixer = device({ id: 'mixer-1', name: 'Mixer', executionTarget: useShowStateStore.getState().deviceId })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    usePluginsStore.setState({ installed: [plugin()] })

    render(
      <CustomTriggerWidget
        config={config({ behavior: 'momentary', commandType: 'strobe', targetLogicalDeviceId: mixer.id })}
      />,
    )
    const button = screen.getByRole('button')

    fireEvent.pointerDown(button)
    await vi.waitFor(() => expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'strobe', payload: { active: true }, logicalDeviceId: mixer.id }))

    fireEvent.pointerUp(button)
    await vi.waitFor(() => expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'strobe', payload: { active: false }, logicalDeviceId: mixer.id }))
  })

  it('momentary: releases on pointer-leave too, so a drag-off never leaves it stuck on', async () => {
    const mixer = device({ id: 'mixer-1', name: 'Mixer', executionTarget: useShowStateStore.getState().deviceId })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    usePluginsStore.setState({ installed: [plugin()] })

    render(
      <CustomTriggerWidget
        config={config({ behavior: 'momentary', commandType: 'strobe', targetLogicalDeviceId: mixer.id })}
      />,
    )
    const button = screen.getByRole('button')

    fireEvent.pointerDown(button)
    fireEvent.pointerLeave(button)
    await vi.waitFor(() => expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'strobe', payload: { active: false }, logicalDeviceId: mixer.id }))
  })

  it('momentary: switches to the active color while held, and back on release', () => {
    const mixer = device({ id: 'mixer-1', name: 'Mixer', executionTarget: useShowStateStore.getState().deviceId })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    usePluginsStore.setState({ installed: [plugin()] })

    render(
      <CustomTriggerWidget
        config={config({ behavior: 'momentary', color: 'accent', targetLogicalDeviceId: mixer.id })}
      />,
    )
    const button = screen.getByRole('button')
    expect(button).not.toHaveClass('bg-accent')

    fireEvent.pointerDown(button)
    expect(button).toHaveClass('bg-accent')

    fireEvent.pointerUp(button)
    expect(button).not.toHaveClass('bg-accent')
  })

  it('latching: toggles on/off on successive clicks', async () => {
    const mixer = device({ id: 'mixer-1', name: 'Mixer', executionTarget: useShowStateStore.getState().deviceId })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    usePluginsStore.setState({ installed: [plugin()] })

    render(
      <CustomTriggerWidget
        config={config({ behavior: 'latching', commandType: 'blinder', targetLogicalDeviceId: mixer.id })}
      />,
    )
    const button = screen.getByRole('button')

    fireEvent.click(button)
    await vi.waitFor(() => expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'blinder', payload: { on: true }, logicalDeviceId: mixer.id }))

    fireEvent.click(button)
    await vi.waitFor(() => expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'blinder', payload: { on: false }, logicalDeviceId: mixer.id }))
  })

  it('merges the configured JSON payload into the fired event', async () => {
    const mixer = device({ id: 'mixer-1', name: 'Mixer', executionTarget: useShowStateStore.getState().deviceId })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    usePluginsStore.setState({ installed: [plugin()] })

    render(
      <CustomTriggerWidget
        config={config({
          behavior: 'latching',
          commandType: 'blinder',
          commandPayloadJson: '{"channel":"DMX-1"}',
          targetLogicalDeviceId: mixer.id,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    await vi.waitFor(() => expect(localMixerApplyEvent).toHaveBeenLastCalledWith({
      type: 'blinder',
      payload: { channel: 'DMX-1', on: true },
      logicalDeviceId: mixer.id,
    }))
  })

  it('falls back to an empty payload for invalid JSON instead of crashing', async () => {
    const mixer = device({ id: 'mixer-1', name: 'Mixer', executionTarget: useShowStateStore.getState().deviceId })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    usePluginsStore.setState({ installed: [plugin()] })

    render(
      <CustomTriggerWidget
        config={config({
          behavior: 'latching',
          commandType: 'blinder',
          commandPayloadJson: '{not json',
          targetLogicalDeviceId: mixer.id,
        })}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    await vi.waitFor(() => expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'blinder', payload: { on: true }, logicalDeviceId: mixer.id }))
  })

  it('routes through the relay when the device is bound to a different tablet', async () => {
    const mixer = device({ id: 'mixer-1', name: 'Mixer', executionTarget: 'some-other-tablet' })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    usePluginsStore.setState({ installed: [plugin()] })

    render(
      <CustomTriggerWidget
        config={config({ behavior: 'latching', commandType: 'blinder', targetLogicalDeviceId: mixer.id })}
      />,
    )
    fireEvent.click(screen.getByRole('button'))

    await vi.waitFor(() =>
      expect(triggerDeviceControl).toHaveBeenCalledWith('ws-1', 'some-other-tablet', 'mixer', {
        type: 'blinder',
        payload: { on: true },
        logicalDeviceId: mixer.id,
      }),
    )
    expect(localMixerApplyEvent).not.toHaveBeenCalled()
  })

  it('forwards to the Stage-Server plugin when unbound', async () => {
    const mixer = device({ id: 'mixer-1', name: 'Mixer', capability: 'lighting' })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    usePluginsStore.setState({
      installed: [plugin({ id: 'mock-lighting', runtime: 'server', capabilities: ['lighting'] })],
    })

    render(
      <CustomTriggerWidget
        config={config({ behavior: 'latching', commandType: 'blackout', targetLogicalDeviceId: mixer.id })}
      />,
    )
    fireEvent.click(screen.getByRole('button'))

    await vi.waitFor(() =>
      expect(triggerShowControl).toHaveBeenCalledWith('mock-lighting', { type: 'blackout', payload: { on: true }, logicalDeviceId: mixer.id }),
    )
  })

  it('any action (docs/23 §7): a show action runs on the master', async () => {
    render(<CustomTriggerWidget config={config({ action: { kind: 'momentary', press: { kind: 'show', op: 'next' }, release: { kind: 'none' } } })} />)
    fireEvent.pointerDown(screen.getByRole('button'))
    await vi.waitFor(() => expect(show.next).toHaveBeenCalled())
  })

  it('without show control the show button is greyed out with the reason - a device button stays usable', () => {
    show.canControl = false
    const mixer = device({ id: 'mixer-1', name: 'Mixer', executionTarget: useShowStateStore.getState().deviceId })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    const { unmount } = render(<CustomTriggerWidget config={config({ action: { kind: 'momentary', press: { kind: 'show', op: 'next' }, release: { kind: 'none' } } })} />)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText('Nur der Master steuert die Show')).toBeInTheDocument()
    unmount()
    render(<CustomTriggerWidget config={config({ targetLogicalDeviceId: mixer.id })} />)
    expect(screen.getByRole('button')).toBeEnabled()
  })

  it('the panel shows an earlier button as its device command and stores it as an action', async () => {
    const mixer = device({ id: 'mixer-1', name: 'Mixer' })
    useLogicalDevicesStore.setState({ devices: [mixer] })
    const onChange = vi.fn()
    render(<CustomTriggerConfigPanel config={config({ behavior: 'latching', commandType: 'blinder', targetLogicalDeviceId: mixer.id })} onChange={onChange} />)
    expect(screen.getByRole('radio', { name: 'Rastend' })).toHaveAttribute('aria-checked', 'true')
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({
          action: { kind: 'latching', on: { kind: 'device', targetLogicalDeviceId: 'mixer-1', type: 'blinder', payload: { on: true } }, off: expect.objectContaining({ payload: { on: false } }) },
        }),
      ),
    )
  })

  it('bound to a switch: its name and colour, lit while another trigger holds it', async () => {
    const { act } = await import('@testing-library/react')
    useSwitchesStore.setState({
      switches: [{ id: 'bl', name: 'Blinder', color: 'amber', behavior: { kind: 'momentary', press: { kind: 'playback', op: 'click-toggle' }, release: { kind: 'none' } } }],
      states: {},
    })
    render(<CustomTriggerWidget config={config({ label: 'Trigger', action: { kind: 'switch', switchId: 'bl' } })} />)
    const button = screen.getByRole('button', { name: 'Blinder' })
    expect(button).not.toHaveClass('bg-amber')
    act(() => useSwitchesStore.getState().setState('bl', 'pressed')) // e.g. a MIDI pedal held down
    expect(button.className).toMatch(/amber/)
    act(() => useSwitchesStore.getState().setState('bl', 'off'))
    expect(button.className).not.toMatch(/amber/)
  })
})

