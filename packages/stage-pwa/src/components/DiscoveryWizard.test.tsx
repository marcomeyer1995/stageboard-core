import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { DiscoverySession, PluginInstallation } from 'shared-types'

// DiscoveryWizard -> usePluginsStore/useLogicalDevicesStore transitively import workspaceDb.ts,
// which constructs a real PouchDB at module load time - unavailable under happy-dom (same mock
// as ShowTransportWidget.test.tsx/cueFiring.test.ts's identical situation).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const startDiscovery = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const stopDiscovery = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('../lib/discoveryClient', () => ({ startDiscovery, stopDiscovery }))

const listenToPortByHardwareKey = vi.hoisted(() => vi.fn().mockResolvedValue(null))
vi.mock('../lib/webMidi', () => ({ listenToPortByHardwareKey }))

const sendCcSequence = vi.hoisted(() => vi.fn().mockResolvedValue(true))
vi.mock('../lib/webMidiOutput', () => ({ sendCcSequence }))

const { DiscoveryWizard } = await import('./DiscoveryWizard')
const { useDiscoverySessionStore } = await import('../store/useDiscoverySessionStore')
const { usePluginsStore } = await import('../store/usePluginsStore')
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')

const KEMPER: PluginInstallation = {
  id: 'kemper-profiler',
  name: 'Kemper Profiler',
  version: '0.0.1',
  runtime: 'client',
  capabilities: ['kemper-control'],
  transports: [],
  hardwareIds: [{ kind: 'webmidi', namePattern: 'Kemper' }],
  discoveryTrigger: {
    instruction: 'Tuner an- und ausschalten.',
    matchCcSequence: [
      { cc: 31, value: 127 },
      { cc: 31, value: 0 },
    ],
    timeoutMs: 15000,
  },
  enabled: true,
  installedAt: 0,
}

function setSession(session: Partial<DiscoverySession>) {
  useDiscoverySessionStore.setState((state) => ({ session: { ...state.session, ...session } }))
}

beforeEach(() => {
  useDiscoverySessionStore.setState({
    workspaceId: 'band-a',
    session: { active: false, startedAt: null, startedBy: null, candidates: [], identifying: null },
  })
  usePluginsStore.setState({ installed: [KEMPER], loaded: true })
  useLogicalDevicesStore.setState({ devices: [{ id: 'marcos-kemper', name: "Marco's Kemper", capability: 'kemper-control' }] })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('DiscoveryWizard', () => {
  it('shows "Starten" when inactive, and opens the modal with the start step', () => {
    render(<DiscoveryWizard />)
    expect(screen.getByRole('button', { name: 'Starten' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Starten' }))
    expect(screen.getByRole('button', { name: 'Geräte-Erkennung starten' })).toBeInTheDocument()
  })

  it('shows "Öffnen" instead once a session is active', () => {
    setSession({ active: true })
    render(<DiscoveryWizard />)
    expect(screen.getByRole('button', { name: 'Öffnen' })).toBeInTheDocument()
  })

  it('starting from the modal calls startDiscovery with the workspace id', () => {
    render(<DiscoveryWizard />)
    fireEvent.click(screen.getByRole('button', { name: 'Starten' }))
    fireEvent.click(screen.getByRole('button', { name: 'Geräte-Erkennung starten' }))
    expect(startDiscovery).toHaveBeenCalledWith('band-a', expect.any(String))
  })

  it('lists candidates with their match/status once a session is active', () => {
    setSession({
      active: true,
      candidates: [
        {
          reporterId: 'tablet-1',
          hardwareKey: 'webmidi:port-1',
          name: 'Kemper Profiler Emulator',
          manufacturer: '',
          matchedPluginId: 'kemper-profiler',
          status: 'assigned',
          assignedLogicalDeviceId: 'marcos-kemper',
        },
      ],
    })
    render(<DiscoveryWizard />)
    fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }))

    expect(screen.getByText(/Kemper Profiler Emulator/)).toBeInTheDocument()
    expect(screen.getByText(/via Kemper Profiler/)).toBeInTheDocument()
    expect(screen.getByText(/Marco's Kemper/)).toBeInTheDocument()
    expect(screen.getByText('zugewiesen')).toBeInTheDocument()
  })

  it('shows the identifying panel with instruction and a manual trigger button for each contender', () => {
    setSession({
      active: true,
      identifying: {
        logicalDeviceId: 'marcos-kemper',
        logicalDeviceName: "Marco's Kemper",
        pluginId: 'kemper-profiler',
        instruction: 'Tuner an- und ausschalten.',
        matchCcSequence: [
          { cc: 31, value: 127 },
          { cc: 31, value: 0 },
        ],
        deadline: Date.now() + 15000,
      },
      candidates: [
        {
          reporterId: 'tablet-1',
          hardwareKey: 'webmidi:port-1',
          name: 'Kemper A',
          manufacturer: '',
          matchedPluginId: 'kemper-profiler',
          status: 'identifying',
          assignedLogicalDeviceId: null,
        },
      ],
    })
    render(<DiscoveryWizard />)
    fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }))

    expect(screen.getByText(/Rolle bestätigen/)).toBeInTheDocument()
    expect(screen.getByText(/Marco's Kemper/)).toBeInTheDocument()
    expect(screen.getByText('Tuner an- und ausschalten.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Jetzt senden' })).toBeInTheDocument()
  })

  it('"Jetzt senden" sends the trigger sequence to the plugin\'s namePattern output', async () => {
    setSession({
      active: true,
      identifying: {
        logicalDeviceId: 'marcos-kemper',
        logicalDeviceName: "Marco's Kemper",
        pluginId: 'kemper-profiler',
        instruction: 'Tuner an- und ausschalten.',
        matchCcSequence: [
          { cc: 31, value: 127 },
          { cc: 31, value: 0 },
        ],
        deadline: Date.now() + 15000,
      },
      candidates: [
        {
          reporterId: 'tablet-1',
          hardwareKey: 'webmidi:port-1',
          name: 'Kemper A',
          manufacturer: '',
          matchedPluginId: 'kemper-profiler',
          status: 'identifying',
          assignedLogicalDeviceId: null,
        },
      ],
    })
    render(<DiscoveryWizard />)
    fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt senden' }))

    await vi.waitFor(() =>
      expect(sendCcSequence).toHaveBeenCalledWith('Kemper', [
        { cc: 31, value: 127 },
        { cc: 31, value: 0 },
      ]),
    )
  })

  it('"Stoppen" calls stopDiscovery, and "Schließen" closes the modal', () => {
    setSession({ active: true })
    render(<DiscoveryWizard />)
    fireEvent.click(screen.getByRole('button', { name: 'Öffnen' }))

    fireEvent.click(screen.getByRole('button', { name: 'Stoppen' }))
    expect(stopDiscovery).toHaveBeenCalledWith('band-a')

    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
    expect(screen.queryByRole('button', { name: 'Schließen' })).not.toBeInTheDocument()
  })
})
