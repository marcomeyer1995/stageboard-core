import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// useWorkspaceStore transitively imports workspaceDb.ts, which constructs a real PouchDB at
// module load time - unavailable under happy-dom (see SyncIndicator.test.tsx's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

// ResolveWorkspaceAdminDialog has its own dedicated test file - here it's mocked out entirely
// so these tests focus purely on WorkspaceHardwareSettings' own job: deciding whether a
// closing dialog is needed before the opening one, and wiring both results into
// activateWorkspaceHardware. Exposes which workspace each mock instance was opened for, and one
// button each for "resolved successfully" / "cancelled", so a test can drive either outcome.
vi.mock('./ResolveWorkspaceAdminDialog', () => ({
  ResolveWorkspaceAdminDialog: ({
    workspaceId,
    onResolved,
  }: {
    workspaceId: string
    workspaceName: string
    onResolved: (credentials: { username: string; password: string; profileId: string } | null) => void
  }) => (
    <div data-testid={`dialog-${workspaceId}`}>
      <button onClick={() => onResolved({ username: `resolved-${workspaceId}-user`, password: `resolved-${workspaceId}-pw`, profileId: `profile-${workspaceId}` })}>
        resolve-ok-{workspaceId}
      </button>
      <button onClick={() => onResolved(null)}>resolve-cancel-{workspaceId}</button>
    </div>
  ),
}))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useActiveProfileStore } = await import('../store/useActiveProfileStore')
const { WorkspaceHardwareSettings } = await import('./WorkspaceHardwareSettings')

const workspaceList = [
  { workspaceId: 'band-a', workspaceName: 'Abadschendaler' },
  { workspaceId: 'band-b', workspaceName: 'SOAT' },
]

beforeEach(() => {
  useWorkspaceStore.setState({
    listWorkspaces: vi.fn().mockResolvedValue(workspaceList),
    fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: 'band-a' }),
    fetchServerInfo: vi.fn().mockResolvedValue({ lanIp: '192.168.1.50', hostname: 'stageboard.local' }),
    activateWorkspaceHardware: vi.fn().mockResolvedValue(true),
  })
})

describe('WorkspaceHardwareSettings', () => {
  it('lists every band the Stage-Server hosts, marking the currently active one', async () => {
    render(<WorkspaceHardwareSettings />)

    await waitFor(() => expect(screen.getByText('Abadschendaler')).toBeInTheDocument())
    expect(screen.getByText('SOAT')).toBeInTheDocument()
    expect(screen.getByText('Aktiv')).toBeInTheDocument()
  })

  it('does nothing when tapping the already-active band', async () => {
    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('Abadschendaler')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Abadschendaler').closest('button')!)
    expect(screen.queryByTestId('dialog-band-a')).not.toBeInTheDocument()
  })

  it('opens the closing dialog first, then the opening dialog, then activates with both resolved credentials', async () => {
    const activateWorkspaceHardware = vi.fn().mockResolvedValue(true)
    useWorkspaceStore.setState({ activateWorkspaceHardware })

    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('SOAT')).toBeInTheDocument())

    fireEvent.click(screen.getByText('SOAT').closest('button')!)

    // Closing dialog (band-a, currently active) appears first, not the opening one yet.
    await waitFor(() => expect(screen.getByTestId('dialog-band-a')).toBeInTheDocument())
    expect(screen.queryByTestId('dialog-band-b')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('resolve-ok-band-a'))

    // Then the opening dialog (band-b).
    await waitFor(() => expect(screen.getByTestId('dialog-band-b')).toBeInTheDocument())
    fireEvent.click(screen.getByText('resolve-ok-band-b'))

    await waitFor(() =>
      expect(activateWorkspaceHardware).toHaveBeenCalledWith(
        'band-b',
        'resolved-band-b-user',
        'resolved-band-b-pw',
        'resolved-band-a-user',
        'resolved-band-a-pw',
      ),
    )
  })

  it('after a successful switch, this device follows: shows the new band, as the admin it just proved itself as', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'band-a' })
    useActiveProfileStore.setState({ byWorkspace: {} })

    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('SOAT')).toBeInTheDocument())
    fireEvent.click(screen.getByText('SOAT').closest('button')!)

    await waitFor(() => expect(screen.getByTestId('dialog-band-a')).toBeInTheDocument())
    fireEvent.click(screen.getByText('resolve-ok-band-a'))
    await waitFor(() => expect(screen.getByTestId('dialog-band-b')).toBeInTheDocument())
    fireEvent.click(screen.getByText('resolve-ok-band-b'))

    await waitFor(() => expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('band-b'))
    expect(useActiveProfileStore.getState().byWorkspace['band-b']).toBe('profile-band-b')
  })

  it('does not change this device\'s workspace when the activation fails', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'band-a', activateWorkspaceHardware: vi.fn().mockResolvedValue(false) })

    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('SOAT')).toBeInTheDocument())
    fireEvent.click(screen.getByText('SOAT').closest('button')!)

    await waitFor(() => expect(screen.getByTestId('dialog-band-a')).toBeInTheDocument())
    fireEvent.click(screen.getByText('resolve-ok-band-a'))
    await waitFor(() => expect(screen.getByTestId('dialog-band-b')).toBeInTheDocument())
    fireEvent.click(screen.getByText('resolve-ok-band-b'))

    await waitFor(() => expect(screen.queryByTestId('dialog-band-b')).not.toBeInTheDocument())
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('band-a')
  })

  it('aborts without activating if the closing dialog is cancelled', async () => {
    const activateWorkspaceHardware = vi.fn().mockResolvedValue(true)
    useWorkspaceStore.setState({ activateWorkspaceHardware })

    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('SOAT')).toBeInTheDocument())
    fireEvent.click(screen.getByText('SOAT').closest('button')!)

    await waitFor(() => expect(screen.getByTestId('dialog-band-a')).toBeInTheDocument())
    fireEvent.click(screen.getByText('resolve-cancel-band-a'))

    await waitFor(() => expect(screen.queryByTestId('dialog-band-a')).not.toBeInTheDocument())
    expect(screen.queryByTestId('dialog-band-b')).not.toBeInTheDocument()
    expect(activateWorkspaceHardware).not.toHaveBeenCalled()
  })

  it('aborts without activating if the opening dialog is cancelled', async () => {
    const activateWorkspaceHardware = vi.fn().mockResolvedValue(true)
    useWorkspaceStore.setState({ activateWorkspaceHardware })

    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('SOAT')).toBeInTheDocument())
    fireEvent.click(screen.getByText('SOAT').closest('button')!)

    await waitFor(() => expect(screen.getByTestId('dialog-band-a')).toBeInTheDocument())
    fireEvent.click(screen.getByText('resolve-ok-band-a'))

    await waitFor(() => expect(screen.getByTestId('dialog-band-b')).toBeInTheDocument())
    fireEvent.click(screen.getByText('resolve-cancel-band-b'))

    await waitFor(() => expect(screen.queryByTestId('dialog-band-b')).not.toBeInTheDocument())
    expect(activateWorkspaceHardware).not.toHaveBeenCalled()
  })

  it('on a first activation (nothing active yet) skips the closing dialog entirely', async () => {
    useWorkspaceStore.setState({ fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: null }) })
    const activateWorkspaceHardware = vi.fn().mockResolvedValue(true)
    useWorkspaceStore.setState({ activateWorkspaceHardware })

    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('SOAT')).toBeInTheDocument())
    fireEvent.click(screen.getByText('SOAT').closest('button')!)

    await waitFor(() => expect(screen.getByTestId('dialog-band-b')).toBeInTheDocument())
    fireEvent.click(screen.getByText('resolve-ok-band-b'))

    await waitFor(() =>
      expect(activateWorkspaceHardware).toHaveBeenCalledWith('band-b', 'resolved-band-b-user', 'resolved-band-b-pw', undefined, undefined),
    )
  })
})
