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

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { ResolveWorkspaceAdminDialog } = await import('./ResolveWorkspaceAdminDialog')

const roster = {
  workspaceId: 'band-b',
  workspaceName: 'SOAT',
  members: [
    { profileId: 'p1', name: 'Marco', isAdmin: true },
    { profileId: 'p2', name: 'A Member', isAdmin: false },
    { profileId: 'p3', name: 'Another Admin', isAdmin: true },
  ],
}

function enterPin(pin: string) {
  fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: pin } })
  fireEvent.click(screen.getByText('Bestätigen'))
}

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [],
    getAccessCode: vi.fn().mockResolvedValue(null),
    fetchRoster: vi.fn().mockResolvedValue(roster),
    activateProfile: vi.fn(),
    resolveMemberCredentials: vi.fn(),
  })
})

describe('ResolveWorkspaceAdminDialog', () => {
  it('with no local history of the workspace, shows the code step first', async () => {
    render(<ResolveWorkspaceAdminDialog workspaceId="band-b" workspaceName="SOAT" onResolved={vi.fn()} />)

    await waitFor(() => expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument())
    expect(screen.queryByText('Marco')).not.toBeInTheDocument()
  })

  it('skips the code step when this device already has a cached admin entry, fetching the roster silently', async () => {
    const getAccessCode = vi.fn().mockResolvedValue({ code: '11112222' })
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-b', name: 'SOAT', isAdmin: true, username: 'stageboard-band-b-p1', couchPassword: 'admin-pw' }],
      getAccessCode,
    })

    render(<ResolveWorkspaceAdminDialog workspaceId="band-b" workspaceName="SOAT" onResolved={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Marco')).toBeInTheDocument())
    expect(screen.queryByPlaceholderText('12345678')).not.toBeInTheDocument()
    expect(getAccessCode).toHaveBeenCalledWith('band-b')
  })

  it('falls back to the code step when the silent getAccessCode path fails (stale local credentials)', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-b', name: 'SOAT', isAdmin: true, username: 'stageboard-band-b-p1', couchPassword: 'stale-pw' }],
      getAccessCode: vi.fn().mockResolvedValue(null),
    })

    render(<ResolveWorkspaceAdminDialog workspaceId="band-b" workspaceName="SOAT" onResolved={vi.fn()} />)

    await waitFor(() => expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument())
  })

  it('the roster picker only lists admins', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-b', name: 'SOAT', isAdmin: true, username: 'x', couchPassword: 'y' }],
      getAccessCode: vi.fn().mockResolvedValue({ code: '11112222' }),
    })

    render(<ResolveWorkspaceAdminDialog workspaceId="band-b" workspaceName="SOAT" onResolved={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('Marco')).toBeInTheDocument())
    expect(screen.getByText('Another Admin')).toBeInTheDocument()
    expect(screen.queryByText('A Member')).not.toBeInTheDocument()
  })

  it('typing the code moves to the roster picker', async () => {
    render(<ResolveWorkspaceAdminDialog workspaceId="band-b" workspaceName="SOAT" onResolved={vi.fn()} />)
    await waitFor(() => expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '11112222' } })
    fireEvent.click(screen.getByText('Weiter'))

    await waitFor(() => expect(screen.getByText('Marco')).toBeInTheDocument())
  })

  it('when this device has no local history, picking an admin then a correct PIN resolves via resolveMemberCredentials, not activateProfile', async () => {
    const resolveMemberCredentials = vi.fn().mockResolvedValue({ id: 'band-b', name: 'SOAT', username: 'stageboard-band-b-p1', couchPassword: 'fresh-pw' })
    const activateProfile = vi.fn()
    useWorkspaceStore.setState({ resolveMemberCredentials, activateProfile })
    const onResolved = vi.fn()

    render(<ResolveWorkspaceAdminDialog workspaceId="band-b" workspaceName="SOAT" onResolved={onResolved} />)
    await waitFor(() => expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '11112222' } })
    fireEvent.click(screen.getByText('Weiter'))

    await waitFor(() => expect(screen.getByText('Marco')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Marco'))

    await waitFor(() => expect(screen.getByPlaceholderText('4-stelliger PIN')).toBeInTheDocument())
    enterPin('1234')

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ username: 'stageboard-band-b-p1', password: 'fresh-pw', profileId: 'p1' }))
    expect(resolveMemberCredentials).toHaveBeenCalledWith('band-b', 'SOAT', '11112222', 'p1', '1234')
    expect(activateProfile).not.toHaveBeenCalled()
  })

  it('when this device already has a cached admin entry, resolves via activateProfile instead', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-b', name: 'SOAT', isAdmin: true, username: 'x', couchPassword: 'y' }],
      getAccessCode: vi.fn().mockResolvedValue({ code: '11112222' }),
    })
    const activateProfile = vi.fn().mockResolvedValue({ id: 'band-b', name: 'SOAT', username: 'stageboard-band-b-p3', couchPassword: 'refreshed-pw' })
    const resolveMemberCredentials = vi.fn()
    useWorkspaceStore.setState({ activateProfile, resolveMemberCredentials })
    const onResolved = vi.fn()

    render(<ResolveWorkspaceAdminDialog workspaceId="band-b" workspaceName="SOAT" onResolved={onResolved} />)
    await waitFor(() => expect(screen.getByText('Another Admin')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Another Admin'))

    await waitFor(() => expect(screen.getByPlaceholderText('4-stelliger PIN')).toBeInTheDocument())
    enterPin('5678')

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith({ username: 'stageboard-band-b-p3', password: 'refreshed-pw', profileId: 'p3' }))
    expect(activateProfile).toHaveBeenCalledWith('band-b', 'p3', '5678')
    expect(resolveMemberCredentials).not.toHaveBeenCalled()
  })

  it('a wrong PIN keeps you on the PIN step, cleared, instead of resolving', async () => {
    useWorkspaceStore.setState({
      workspaces: [{ id: 'band-b', name: 'SOAT', isAdmin: true, username: 'x', couchPassword: 'y' }],
      getAccessCode: vi.fn().mockResolvedValue({ code: '11112222' }),
      activateProfile: vi.fn().mockResolvedValue(null),
    })
    const onResolved = vi.fn()

    render(<ResolveWorkspaceAdminDialog workspaceId="band-b" workspaceName="SOAT" onResolved={onResolved} />)
    await waitFor(() => expect(screen.getByText('Marco')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Marco'))

    await waitFor(() => expect(screen.getByPlaceholderText('4-stelliger PIN')).toBeInTheDocument())
    enterPin('0000')

    await waitFor(() => expect(screen.getByPlaceholderText('4-stelliger PIN')).toHaveValue(''))
    expect(onResolved).not.toHaveBeenCalled()
  })

  it('cancel at any step calls onResolved(null)', async () => {
    const onResolved = vi.fn()
    render(<ResolveWorkspaceAdminDialog workspaceId="band-b" workspaceName="SOAT" onResolved={onResolved} />)
    await waitFor(() => expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Abbrechen'))
    expect(onResolved).toHaveBeenCalledWith(null)
  })
})
