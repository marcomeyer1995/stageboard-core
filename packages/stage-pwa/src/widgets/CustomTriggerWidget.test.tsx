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

const { usePluginsStore } = await import('../store/usePluginsStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { CustomTriggerWidget } = await import('./CustomTriggerWidget')

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
  usePluginsStore.setState({ installed: [], health: { plugins: {} } })
  useLogicalDevicesStore.setState({ devices: [] })
  useWorkspaceStore.setState({ activeWorkspaceId: 'ws-1' })
})

describe('CustomTriggerWidget', () => {
  it('disables the button when no target device is configured', () => {
    render(<CustomTriggerWidget config={config()} />)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText('Kein Zielgerät konfiguriert')).toBeInTheDocument()
  })

  it('momentary: fires active=true on press and active=false on release', () => {
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
    expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'strobe', payload: { active: true } })

    fireEvent.pointerUp(button)
    expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'strobe', payload: { active: false } })
  })

  it('momentary: releases on pointer-leave too, so a drag-off never leaves it stuck on', () => {
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
    expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'strobe', payload: { active: false } })
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

  it('latching: toggles on/off on successive clicks', () => {
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
    expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'blinder', payload: { on: true } })

    fireEvent.click(button)
    expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'blinder', payload: { on: false } })
  })

  it('merges the configured JSON payload into the fired event', () => {
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
    expect(localMixerApplyEvent).toHaveBeenLastCalledWith({
      type: 'blinder',
      payload: { channel: 'DMX-1', on: true },
    })
  })

  it('falls back to an empty payload for invalid JSON instead of crashing', () => {
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
    expect(localMixerApplyEvent).toHaveBeenLastCalledWith({ type: 'blinder', payload: { on: true } })
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
      expect(triggerShowControl).toHaveBeenCalledWith('mock-lighting', { type: 'blackout', payload: { on: true } }),
    )
  })
})
