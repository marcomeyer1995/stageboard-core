import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const { useLogicalDevicesStore } = await import('../store/useLogicalDevicesStore')
const { DeviceLedgerView } = await import('./DeviceLedgerView')

/** Opens the row's ⋯ menu and taps an action in it. */
function menuAction(device: string, action: string) {
  fireEvent.click(screen.getByRole('button', { name: `Menü: ${device}` }))
  fireEvent.click(screen.getByRole('button', { name: action }))
}

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
    // useStageServerStatus.ts fires all three on every mount (the new "Stage-Server" row) -
    // same "every test needs some stub for it" reasoning as JoinBandView.test.tsx's default
    // for listWorkspaces(); a test that doesn't care about this row gets a deterministic
    // "unreachable" state instead of a stray real fetch.
    listWorkspaces: vi.fn().mockResolvedValue(null),
    fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue(null),
    fetchServerInfo: vi.fn().mockResolvedValue(null),
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
    loaded: true,
    init: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  })
  useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue(undefined) })
  useLogicalDevicesStore.setState({ devices: [] })
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

  it('hides the ⋯ menu for a non-admin session', () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-a', name: 'Band A', couchPassword: 'member-pw', username: 'stageboard-band-a-p2', isAdmin: false }],
      activeWorkspaceId: 'band-a',
    })
    render(<DeviceLedgerView />)
    expect(screen.queryByRole('button', { name: 'Menü: Marcos iPad' })).not.toBeInTheDocument()
  })

  it('"Blockieren" (formerly "Entfernen") blocks after confirmation, calling revoke with revoked=true', async () => {
    const revoke = vi.fn().mockResolvedValue(true)
    useDevicesStore.setState({ revoke })
    render(<DeviceLedgerView />)

    menuAction('Marcos iPad', 'Blockieren')

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('band-a', 'device-1', true))
  })

  it('does not call revoke when the kick confirmation is declined', async () => {
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(false) })
    const revoke = vi.fn()
    useDevicesStore.setState({ revoke })
    render(<DeviceLedgerView />)

    menuAction('Marcos iPad', 'Blockieren')

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

    menuAction('Marcos iPad', 'Wieder zulassen')

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('band-a', 'device-1', false))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('"Aus Liste entfernen" forgets a device after confirmation - not offered for a blocked one', async () => {
    const forget = vi.fn().mockResolvedValue('removed')
    useDevicesStore.setState({ forget })
    const { unmount } = render(<DeviceLedgerView />)
    menuAction('Marcos iPad', 'Aus Liste entfernen')
    await waitFor(() => expect(forget).toHaveBeenCalledWith('band-a', 'device-1'))
    unmount()

    useDevicesStore.setState({ devices: [{ id: 'device-1', name: 'Marcos iPad', lastSeenAt: Date.now(), firstSeenAt: 1, revoked: true }] })
    render(<DeviceLedgerView />)
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Marcos iPad' }))
    expect(screen.queryByRole('button', { name: 'Aus Liste entfernen' })).not.toBeInTheDocument()
    expect(screen.getByText('blockiert')).toBeInTheDocument()
  })

  it('a device hardware runs on says where it is used and cannot be removed', () => {
    useLogicalDevicesStore.setState({ devices: [{ id: 'k', name: 'Kemper', executionTarget: 'device-1' }] as never })
    render(<DeviceLedgerView />)
    expect(screen.getByText(/In Verwendung: Kemper - im Tab Hardware ein anderes Gerät wählen/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Marcos iPad' }))
    expect(screen.getByRole('button', { name: 'Aus Liste entfernen' })).toBeDisabled()
  })

  it('"Inaktive entfernen" takes every device without a live signal once the server has collected for 5 minutes - not blocked, not used, not this one', async () => {
    const forget = vi.fn().mockResolvedValue('removed')
    const old = Date.now() - 10 * 86_400_000
    useDevicesStore.setState({
      forget,
      devices: [
        { id: 'device-1', name: 'Marcos iPad', lastSeenAt: Date.now(), firstSeenAt: 1, revoked: false },
        { id: 'old-1', name: 'Altes Tablet', lastSeenAt: old, firstSeenAt: 1, revoked: false },
        { id: 'recent', name: 'Doppeltes Tablet', lastSeenAt: Date.now() - 3_600_000, firstSeenAt: 1, revoked: false },
        { id: 'old-blocked', name: 'Gesperrt', lastSeenAt: old, firstSeenAt: 1, revoked: true },
        { id: 'old-used', name: 'Kemper-Tablet', lastSeenAt: old, firstSeenAt: 1, revoked: false },
      ],
    })
    useDeviceInfoStore.setState({ deviceInfo: { devices: { 'device-1': DEVICE_INFO_ENTRY }, collectingSince: Date.now() - 10 * 60_000 } })
    useLogicalDevicesStore.setState({ devices: [{ id: 'k', name: 'Kemper', executionTarget: 'old-used' }] as never })
    render(<DeviceLedgerView />)
    fireEvent.click(screen.getByRole('button', { name: 'Inaktive entfernen (2)' }))
    await waitFor(() => expect(forget).toHaveBeenCalledTimes(2))
    expect(forget.mock.calls.map((call) => call[1]).sort()).toEqual(['old-1', 'recent'])
    expect(screen.getByText(/1 inaktive bleiben, weil Hardware sie verwendet/)).toBeInTheDocument()
  })

  it('right after a server start nothing counts as inactive yet - the devices are still reporting', () => {
    useDevicesStore.setState({ devices: [{ id: 'old-1', name: 'Altes Tablet', lastSeenAt: Date.now() - 10 * 86_400_000, firstSeenAt: 1, revoked: false }] })
    useDeviceInfoStore.setState({ deviceInfo: { devices: {}, collectingSince: Date.now() - 60_000 } })
    render(<DeviceLedgerView />)
    expect(screen.getByRole('button', { name: 'Inaktive entfernen (0)' })).toBeDisabled()
    expect(screen.getByText(/Der Stage-Server wurde gerade gestartet/)).toBeInTheDocument()
  })

  it('before the first device report nothing counts as inactive (#426 review)', () => {
    useDevicesStore.setState({ devices: [{ id: 'old-1', name: 'Altes Tablet', lastSeenAt: Date.now() - 10 * 86_400_000, firstSeenAt: 1, revoked: false }] })
    useDeviceInfoStore.setState({ deviceInfo: { devices: {} }, loaded: false })
    render(<DeviceLedgerView />)
    expect(screen.getByRole('button', { name: 'Inaktive entfernen (0)' })).toBeDisabled()
  })

  it('only devices still inactive after the question are removed (#426 review)', async () => {
    const forget = vi.fn().mockResolvedValue('removed')
    let answer: (ok: boolean) => void = () => {}
    useDialogStore.setState({ confirm: vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve))) })
    useDevicesStore.setState({
      forget,
      devices: [
        { id: 'device-1', name: 'Marcos iPad', lastSeenAt: Date.now(), firstSeenAt: 1, revoked: false },
        { id: 'old-1', name: 'Altes Tablet', lastSeenAt: 1, firstSeenAt: 1, revoked: false },
        { id: 'old-2', name: 'Caros Tablet', lastSeenAt: 1, firstSeenAt: 1, revoked: false },
      ],
    })
    useDeviceInfoStore.setState({ deviceInfo: { devices: { 'device-1': DEVICE_INFO_ENTRY }, collectingSince: Date.now() - 10 * 60_000 } })
    render(<DeviceLedgerView />)
    fireEvent.click(screen.getByRole('button', { name: 'Inaktive entfernen (2)' }))
    // Caro opens the app while the question is open.
    act(() => {
      useDeviceInfoStore.setState({
        deviceInfo: { devices: { 'device-1': DEVICE_INFO_ENTRY, 'old-2': { ...DEVICE_INFO_ENTRY, lastSeenAt: Date.now() } }, collectingSince: Date.now() - 10 * 60_000 },
      })
    })
    await act(async () => answer(true))
    await waitFor(() => expect(forget).toHaveBeenCalledTimes(1))
    expect(forget).toHaveBeenCalledWith('band-a', 'old-1')
  })

  it('says so when the device was blocked in the meantime (#426 review)', async () => {
    const alert = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({ alert })
    useDevicesStore.setState({ forget: vi.fn().mockResolvedValue('blocked') })
    render(<DeviceLedgerView />)
    menuAction('Marcos iPad', 'Aus Liste entfernen')
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('inzwischen blockiert')))
  })

  it('an older server without collectingSince: falls back to "not seen for a day"', () => {
    useDevicesStore.setState({
      devices: [
        { id: 'old-1', name: 'Altes Tablet', lastSeenAt: Date.now() - 10 * 86_400_000, firstSeenAt: 1, revoked: false },
        { id: 'recent', name: 'Handy', lastSeenAt: Date.now() - 3_600_000, firstSeenAt: 1, revoked: false },
      ],
    })
    useDeviceInfoStore.setState({ deviceInfo: { devices: {} } })
    render(<DeviceLedgerView />)
    expect(screen.getByRole('button', { name: 'Inaktive entfernen (1)' })).toBeInTheDocument()
  })

  it('alerts when revoke fails', async () => {
    const revoke = vi.fn().mockResolvedValue(false)
    const alert = vi.fn().mockResolvedValue(undefined)
    useDevicesStore.setState({ revoke })
    useDialogStore.setState({ alert })
    render(<DeviceLedgerView />)

    menuAction('Marcos iPad', 'Blockieren')

    await waitFor(() => expect(alert).toHaveBeenCalled())
  })

  describe('Stage-Server row', () => {
    it('shows "keine Verbindung" while unreachable', async () => {
      render(<DeviceLedgerView />)
      await waitFor(() => expect(screen.getByText('Keine Verbindung zum Stage-Server.')).toBeInTheDocument())
    })

    it('says the server is slow to answer, not that the connection is gone, while requests are merely late', async () => {
      vi.useFakeTimers()
      const never = () => new Promise<never>(() => {})
      useWorkspaceStore.setState({
        listWorkspaces: vi.fn().mockImplementation(never),
        fetchActiveWorkspaceHardware: vi.fn().mockImplementation(never),
        fetchServerInfo: vi.fn().mockImplementation(never),
      })
      render(<DeviceLedgerView />)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(8100)
      })

      expect(screen.getByText('Stage-Server antwortet langsam…')).toBeInTheDocument()
      expect(screen.queryByText('Keine Verbindung zum Stage-Server.')).not.toBeInTheDocument()
      vi.useRealTimers()
    })

    it('shows IP, hostname, and the active band once reachable', async () => {
      useWorkspaceStore.setState({
        listWorkspaces: vi.fn().mockResolvedValue([{ workspaceId: 'band-a', workspaceName: 'Band A' }]),
        fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: 'band-a' }),
        fetchServerInfo: vi.fn().mockResolvedValue({ lanIp: '192.168.1.50', hostname: 'stageboard.local' }),
      })

      render(<DeviceLedgerView />)

      await waitFor(() => expect(screen.getByText(/IP 192\.168\.1\.50/)).toBeInTheDocument())
      expect(screen.getByText('stageboard.local', { exact: false })).toBeInTheDocument()
      expect(screen.getByText('Aktive Band: Band A')).toBeInTheDocument()
    })

    it('shows "keine" for the active band when reachable but nothing has been activated yet', async () => {
      useWorkspaceStore.setState({
        listWorkspaces: vi.fn().mockResolvedValue([]),
        fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: null }),
        fetchServerInfo: vi.fn().mockResolvedValue({ lanIp: '192.168.1.50', hostname: 'stageboard.local' }),
      })

      render(<DeviceLedgerView />)

      await waitFor(() => expect(screen.getByText('Aktive Band: keine')).toBeInTheDocument())
    })
  })
})
