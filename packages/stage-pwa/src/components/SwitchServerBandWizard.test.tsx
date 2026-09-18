import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

// The real VerifyWorkspaceAdmin runs here; only the store actions that touch the network are
// stubbed - so this exercises the wizard exactly as it's used, including the closing-then-opening
// sequence that broke live (the second step inheriting the first one's state).
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useActiveProfileStore } = await import('../store/useActiveProfileStore')
const { SwitchServerBandWizard } = await import('./SwitchServerBandWizard')

const bands = [
  { workspaceId: 'band-a', workspaceName: 'Abadschendaler' },
  { workspaceId: 'band-b', workspaceName: 'SOAT' },
]
const rosterFor = (id: string) => ({
  workspaceId: id,
  workspaceName: id === 'band-a' ? 'Abadschendaler' : 'SOAT',
  members: [
    { profileId: `${id}-admin`, name: `Admin ${id}`, isAdmin: true },
    { profileId: `${id}-member`, name: `Member ${id}`, isAdmin: false },
  ],
})
const cachedAdmin = (id: string) => ({ id, name: id, isAdmin: true, username: `${id}-user`, couchPassword: `${id}-pw` })

const verifyAdminPin = vi.fn()
const activateWorkspaceHardware = vi.fn()
const activateProfile = vi.fn()
const joinAsMember = vi.fn()
const getAccessCode = vi.fn()
const fetchRoster = vi.fn()
const fetchActiveWorkspaceAdmins = vi.fn()

function enterPin(value: string) {
  fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value } })
  fireEvent.click(screen.getByText('Bestätigen'))
}
function enterCode(value: string) {
  fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value } })
  fireEvent.click(screen.getByText('Weiter'))
}

beforeEach(() => {
  verifyAdminPin.mockReset().mockResolvedValue(true)
  activateWorkspaceHardware.mockReset().mockResolvedValue(true)
  activateProfile.mockReset().mockResolvedValue({ id: 'x' })
  joinAsMember.mockReset().mockResolvedValue({ id: 'x' })
  getAccessCode.mockReset().mockResolvedValue({ code: '11112222' })
  fetchRoster.mockReset().mockImplementation(async (id: string) => rosterFor(id))
  // The server's code-free list of the *active* band's admins (band-a in these tests).
  fetchActiveWorkspaceAdmins.mockReset().mockResolvedValue([{ profileId: 'band-a-admin', name: 'Admin band-a' }])
  useWorkspaceStore.setState({
    // This device holds an admin session in Abadschendaler (the active band) - not in SOAT.
    workspaces: [cachedAdmin('band-a')],
    activeWorkspaceId: 'band-a',
    verifyAdminPin,
    activateWorkspaceHardware,
    activateProfile,
    joinAsMember,
    getAccessCode,
    fetchRoster,
    fetchActiveWorkspaceAdmins,
  })
  useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'band-a-admin' } })
})

describe('SwitchServerBandWizard', () => {
  describe('closing the currently active band', () => {
    it('asks only for the PIN of this device\'s current admin - no name, no code - then shows every band', async () => {
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={vi.fn()} />)

      expect(screen.getByText('PIN des angemeldeten Admins eingeben.')).toBeInTheDocument()
      expect(screen.queryByPlaceholderText('12345678')).not.toBeInTheDocument()
      expect(screen.queryByText('Admin band-a')).not.toBeInTheDocument()

      enterPin('1111')

      await waitFor(() => expect(screen.getByText('Zu welcher Band wechseln?')).toBeInTheDocument())
      expect(verifyAdminPin).toHaveBeenCalledWith('band-a', 'band-a-admin', '1111')
      expect(screen.getByText('Abadschendaler')).toBeInTheDocument()
      expect(screen.getByText('SOAT')).toBeInTheDocument()
    })

    it('stops here on a wrong PIN - no band list, nothing activated', async () => {
      verifyAdminPin.mockResolvedValue(false)
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={vi.fn()} />)

      enterPin('0000')

      await waitFor(() => expect(verifyAdminPin).toHaveBeenCalled())
      expect(screen.queryByText('Zu welcher Band wechseln?')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('4-stelliger PIN')).toHaveValue('')
      expect(activateWorkspaceHardware).not.toHaveBeenCalled()
    })

    it('can be aborted', () => {
      const onClose = vi.fn()
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={onClose} />)

      fireEvent.click(screen.getByText('Abbrechen'))

      expect(onClose).toHaveBeenCalledWith(false)
      expect(activateWorkspaceHardware).not.toHaveBeenCalled()
    })

    it('with no admin session in the active band, lists that band\'s admins straight from the server - no band code - then asks that admin\'s PIN', async () => {
      useWorkspaceStore.setState({ workspaces: [] })
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={vi.fn()} />)

      await waitFor(() => expect(screen.getByText('Admin band-a')).toBeInTheDocument())
      expect(screen.queryByPlaceholderText('12345678')).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('Admin band-a'))
      enterPin('1111')

      await waitFor(() => expect(screen.getByText('Zu welcher Band wechseln?')).toBeInTheDocument())
      expect(verifyAdminPin).toHaveBeenCalledWith('band-a', 'band-a-admin', '1111')
      // The band is already registered on the server: its code was never needed.
      expect(getAccessCode).not.toHaveBeenCalled()
      expect(fetchRoster).not.toHaveBeenCalled()
    })

    it('only falls back to the band code when the server can\'t list the active band\'s admins', async () => {
      useWorkspaceStore.setState({ workspaces: [] })
      fetchActiveWorkspaceAdmins.mockResolvedValue(null)
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={vi.fn()} />)

      await waitFor(() => expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument())
      enterCode('11112222')
      await waitFor(() => expect(screen.getByText('Admin band-a')).toBeInTheDocument())
      expect(screen.queryByText('Member band-a')).not.toBeInTheDocument()
    })

    it('"Anderer Admin wählen" leaves the known profile for the admin picker', async () => {
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={vi.fn()} />)

      fireEvent.click(screen.getByText('Anderer Admin wählen'))

      await waitFor(() => expect(screen.getByText('Admin band-a')).toBeInTheDocument())
      expect(screen.queryByPlaceholderText('12345678')).not.toBeInTheDocument()
    })
  })

  it('with nothing active yet, skips straight to the band list', () => {
    render(<SwitchServerBandWizard bands={bands} activeWorkspaceId={null} onClose={vi.fn()} />)

    expect(screen.getByText('Zu welcher Band wechseln?')).toBeInTheDocument()
    expect(screen.getByText('SOAT').closest('button')).not.toBeDisabled()
  })

  it('lists the active band as "Aktiv" and not selectable', async () => {
    render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={vi.fn()} />)
    enterPin('1111')
    await waitFor(() => expect(screen.getByText('Zu welcher Band wechseln?')).toBeInTheDocument())

    expect(screen.getByText('Abadschendaler').closest('button')).toBeDisabled()
    expect(screen.getByText('Aktiv')).toBeInTheDocument()
  })

  describe('opening the target band', () => {
    async function reachBandList() {
      enterPin('1111')
      await waitFor(() => expect(screen.getByText('Zu welcher Band wechseln?')).toBeInTheDocument())
    }

    it('a band this device never cached: asks for its code, lists its admins, verifies the PIN, commits with both proofs, then joins it (found live: the opening step used to inherit the closing step\'s state and silently do nothing)', async () => {
      const onClose = vi.fn()
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={onClose} />)
      await reachBandList()

      fireEvent.click(screen.getByText('SOAT'))
      await waitFor(() => expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument())
      enterCode('99512679')
      await waitFor(() => expect(screen.getByText('Admin band-b')).toBeInTheDocument())
      expect(screen.queryByText('Member band-b')).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('Admin band-b'))
      enterPin('2222')

      await waitFor(() =>
        expect(activateWorkspaceHardware).toHaveBeenCalledWith(
          'band-b',
          { profileId: 'band-b-admin', pin: '2222' },
          { profileId: 'band-a-admin', pin: '1111' },
        ),
      )
      expect(verifyAdminPin).toHaveBeenCalledWith('band-b', 'band-b-admin', '2222')
      await waitFor(() => expect(joinAsMember).toHaveBeenCalledWith('band-b', 'SOAT', '99512679', 'band-b-admin', '2222'))
      expect(activateProfile).not.toHaveBeenCalled()
      await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
      expect(useActiveProfileStore.getState().byWorkspace['band-b']).toBe('band-b-admin')
    })

    it('a band this device has cached as admin: no code step, and this device follows via activateProfile', async () => {
      useWorkspaceStore.setState({ workspaces: [cachedAdmin('band-a'), cachedAdmin('band-b')] })
      const onClose = vi.fn()
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={onClose} />)
      await reachBandList()

      fireEvent.click(screen.getByText('SOAT'))
      await waitFor(() => expect(screen.getByText('Admin band-b')).toBeInTheDocument())
      expect(screen.queryByPlaceholderText('12345678')).not.toBeInTheDocument()
      fireEvent.click(screen.getByText('Admin band-b'))
      enterPin('2222')

      await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
      expect(activateProfile).toHaveBeenCalledWith('band-b', 'band-b-admin', '2222')
      expect(joinAsMember).not.toHaveBeenCalled()
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('band-b')
      expect(useActiveProfileStore.getState().byWorkspace['band-b']).toBe('band-b-admin')
    })

    it('a wrong target PIN activates nothing', async () => {
      useWorkspaceStore.setState({ workspaces: [cachedAdmin('band-a'), cachedAdmin('band-b')] })
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={vi.fn()} />)
      await reachBandList()
      fireEvent.click(screen.getByText('SOAT'))
      await waitFor(() => expect(screen.getByText('Admin band-b')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Admin band-b'))
      verifyAdminPin.mockResolvedValue(false)

      enterPin('0000')

      await waitFor(() => expect(screen.getByPlaceholderText('4-stelliger PIN')).toHaveValue(''))
      expect(activateWorkspaceHardware).not.toHaveBeenCalled()
    })

    it('can be aborted at the band list and at the target step, activating nothing', async () => {
      const onClose = vi.fn()
      const { unmount } = render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={onClose} />)
      await reachBandList()
      fireEvent.click(screen.getByText('Abbrechen'))
      expect(onClose).toHaveBeenLastCalledWith(false)
      unmount()

      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={onClose} />)
      await reachBandList()
      fireEvent.click(screen.getByText('SOAT'))
      await waitFor(() => expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Abbrechen'))
      expect(onClose).toHaveBeenLastCalledWith(false)
      expect(activateWorkspaceHardware).not.toHaveBeenCalled()
    })

    it('when the server rejects the commit, returns to the band list without closing or following', async () => {
      useWorkspaceStore.setState({ workspaces: [cachedAdmin('band-a'), cachedAdmin('band-b')] })
      activateWorkspaceHardware.mockResolvedValue(false)
      const onClose = vi.fn()
      render(<SwitchServerBandWizard bands={bands} activeWorkspaceId="band-a" onClose={onClose} />)
      await reachBandList()
      fireEvent.click(screen.getByText('SOAT'))
      await waitFor(() => expect(screen.getByText('Admin band-b')).toBeInTheDocument())
      fireEvent.click(screen.getByText('Admin band-b'))
      enterPin('2222')

      await waitFor(() => expect(screen.getByText('Zu welcher Band wechseln?')).toBeInTheDocument())
      expect(onClose).not.toHaveBeenCalled()
      expect(activateProfile).not.toHaveBeenCalled()
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('band-a')
    })
  })

  it('on a first activation (nothing active) commits with only the opening proof', async () => {
    useWorkspaceStore.setState({ workspaces: [cachedAdmin('band-b')] })
    render(<SwitchServerBandWizard bands={bands} activeWorkspaceId={null} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('SOAT'))
    await waitFor(() => expect(screen.getByText('Admin band-b')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Admin band-b'))
    enterPin('2222')

    await waitFor(() =>
      expect(activateWorkspaceHardware).toHaveBeenCalledWith('band-b', { profileId: 'band-b-admin', pin: '2222' }, undefined),
    )
  })
})
