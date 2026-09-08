import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// useWorkspaceStore.ts (transitively, via useDevicesStore.ts's revoke()) imports
// workspaceDb.ts, which constructs a real PouchDB at module load time - unavailable under
// happy-dom, same mock as SystemView.test.tsx's own.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useDevicesStore } = await import('../store/useDevicesStore')
const { useDeviceInfoStore } = await import('../store/useDeviceInfoStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { DeviceLedgerView } = await import('./DeviceLedgerView')

const DEVICE_INFO_ENTRY = {
  ip: '192.168.1.10',
  os: 'iPad',
  environment: 'browser' as const,
  syncStatus: 'idle' as const,
  lastSeenAt: Date.now(),
  networkReachable: true,
  hostname: null,
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'admin-pw', username: 'stageboard-band-a-p1', isAdmin: true }],
    activeWorkspaceId: 'band-a',
  })
  useDevicesStore.setState({
    devices: [{ id: 'device-1', name: 'Marcos iPad', lastSeenAt: Date.now(), firstSeenAt: Date.now() - 100_000, revoked: false }],
  })
  // The component's own effect calls the real init()/stop() on mount/unmount (see
  // useDeviceInfoStore.ts's doc comment: polling only happens while this screen is open) -
  // stubbed here so this test focuses on rendering logic given a state, not the live polling
  // wiring (covered separately by fetchDeviceInfo.test.ts).
  useDeviceInfoStore.setState({
    deviceInfo: { devices: { 'device-1': DEVICE_INFO_ENTRY } },
    init: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  })
  useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue(undefined) })
})

describe('DeviceLedgerView', () => {
  it('shows nothing registered when there are no devices', () => {
    useDevicesStore.setState({ devices: [] })
    render(<DeviceLedgerView />)
    expect(screen.getByText('Noch keine Geräte registriert.')).toBeInTheDocument()
  })

  it('renders a device with its live diagnostic info', () => {
    render(<DeviceLedgerView />)

    expect(screen.getByText('Marcos iPad')).toBeInTheDocument()
    expect(screen.getByText('IP 192.168.1.10')).toBeInTheDocument()
    expect(screen.getByText('iPad')).toBeInTheDocument()
    expect(screen.getByText('Browser')).toBeInTheDocument()
    expect(screen.getByText('Synchronisiert')).toBeInTheDocument()
  })

  it('shows "unbekannt" rather than "Invalid Date" for a doc written before firstSeenAt existed', () => {
    useDevicesStore.setState({
      devices: [{ id: 'device-1', name: 'Marcos iPad', lastSeenAt: Date.now() } as never],
    })
    render(<DeviceLedgerView />)
    expect(screen.getByText(/Zuerst gesehen unbekannt/)).toBeInTheDocument()
  })

  it('shows the reverse-DNS hostname next to the IP when resolved', () => {
    useDeviceInfoStore.setState({ deviceInfo: { devices: { 'device-1': { ...DEVICE_INFO_ENTRY, hostname: 'ipad.local' } } } })
    render(<DeviceLedgerView />)
    expect(screen.getByText('(ipad.local)')).toBeInTheDocument()
  })

  it('shows a placeholder for a device with no diagnostic report yet', () => {
    useDeviceInfoStore.setState({ deviceInfo: { devices: {} } })
    render(<DeviceLedgerView />)
    expect(screen.getByText('Noch keine Diagnosedaten von diesem Gerät.')).toBeInTheDocument()
  })

  it('hides the kick/restore button for a non-admin session', () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false }],
      activeWorkspaceId: 'band-a',
    })
    render(<DeviceLedgerView />)
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument()
  })

  it('kicks a device after confirmation, calling revoke with revoked=true', async () => {
    const revoke = vi.fn().mockResolvedValue(true)
    useDevicesStore.setState({ revoke })
    render(<DeviceLedgerView />)

    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('band-a', 'device-1', true))
  })

  it('does not call revoke when the kick confirmation is declined', async () => {
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(false) })
    const revoke = vi.fn()
    useDevicesStore.setState({ revoke })
    render(<DeviceLedgerView />)

    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => expect(useDialogStore.getState().confirm).toHaveBeenCalled())
    expect(revoke).not.toHaveBeenCalled()
  })

  it('restores a revoked device without a confirmation prompt', async () => {
    useDevicesStore.setState({
      devices: [{ id: 'device-1', name: 'Marcos iPad', lastSeenAt: Date.now(), firstSeenAt: Date.now() - 100_000, revoked: true }],
    })
    const confirm = vi.fn().mockResolvedValue(true)
    const revoke = vi.fn().mockResolvedValue(true)
    useDialogStore.setState({ confirm })
    useDevicesStore.setState({ revoke })
    render(<DeviceLedgerView />)

    fireEvent.click(screen.getByRole('button', { name: 'Wieder zulassen' }))

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('band-a', 'device-1', false))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('alerts when revoke fails', async () => {
    const revoke = vi.fn().mockResolvedValue(false)
    const alert = vi.fn().mockResolvedValue(undefined)
    useDevicesStore.setState({ revoke })
    useDialogStore.setState({ alert })
    render(<DeviceLedgerView />)

    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }))

    await waitFor(() => expect(alert).toHaveBeenCalled())
  })
})
