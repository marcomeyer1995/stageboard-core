import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { LogicalDevice, PluginInstallation } from 'shared-types'

// usePluginsStore/useLogicalDevicesStore transitively import workspaceDb.ts, which constructs
// a real PouchDB at module load time - unavailable under happy-dom (see workspaceDb.test.ts's
// identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { usePluginsStore } = await import('../store/usePluginsStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { DeviceStatusWidget } = await import('./DeviceStatusWidget')

function device(overrides: Partial<LogicalDevice> & Pick<LogicalDevice, 'id' | 'name'>): LogicalDevice {
  return { capability: 'mixer', pluginId: null, executionTarget: null, ...overrides }
}

function plugin(overrides: Partial<PluginInstallation> = {}): PluginInstallation {
  return {
    id: 'mock-mixer',
    name: 'Mock Mixer',
    version: '0.0.1',
    runtime: 'server',
    capabilities: ['mixer'],
    transports: [],
    hardwareIds: [],
    enabled: true,
    installedAt: 0,
    ...overrides,
  }
}

beforeEach(() => {
  usePluginsStore.setState({ installed: [], health: { plugins: {} } })
  useLogicalDevicesStore.setState({ devices: [] })
})

describe('DeviceStatusWidget', () => {
  it('shows an empty state when no device is configured', () => {
    render(<DeviceStatusWidget config={{}} />)
    expect(screen.getByText('Kein Gerät ausgewählt')).toBeInTheDocument()
  })

  it('shows "nicht verbunden" when the device has no bound or providing plugin', () => {
    const kemper = device({ id: 'kemper-1', name: "Marco's Kemper" })
    useLogicalDevicesStore.setState({ devices: [kemper] })
    render(<DeviceStatusWidget config={{ logicalDeviceId: 'kemper-1' }} />)
    expect(screen.getByText('Nicht verbunden')).toBeInTheDocument()
  })

  it('shows online for a plugin with a fresh heartbeat', () => {
    const kemper = device({ id: 'kemper-1', name: "Marco's Kemper", pluginId: 'mock-mixer' })
    useLogicalDevicesStore.setState({ devices: [kemper] })
    usePluginsStore.setState({
      installed: [plugin()],
      health: { plugins: { 'mock-mixer': { status: 'online', lastSeenAt: Date.now() } } },
    })
    render(<DeviceStatusWidget config={{ logicalDeviceId: 'kemper-1' }} />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })

  it('shows "nicht erreichbar" once the heartbeat goes stale', () => {
    const kemper = device({ id: 'kemper-1', name: "Marco's Kemper", pluginId: 'mock-mixer' })
    useLogicalDevicesStore.setState({ devices: [kemper] })
    usePluginsStore.setState({
      installed: [plugin()],
      health: { plugins: { 'mock-mixer': { status: 'online', lastSeenAt: Date.now() - 20_000 } } },
    })
    render(<DeviceStatusWidget config={{ logicalDeviceId: 'kemper-1' }} />)
    expect(screen.getByText('Nicht erreichbar')).toBeInTheDocument()
  })

  it('falls back to whichever plugin provides the capability when the device has no explicit pluginId', () => {
    const kemper = device({ id: 'kemper-1', name: "Marco's Kemper" })
    useLogicalDevicesStore.setState({ devices: [kemper] })
    usePluginsStore.setState({
      installed: [plugin()],
      health: { plugins: { 'mock-mixer': { status: 'online', lastSeenAt: Date.now() } } },
    })
    render(<DeviceStatusWidget config={{ logicalDeviceId: 'kemper-1' }} />)
    expect(screen.getByText('Online')).toBeInTheDocument()
  })
})
