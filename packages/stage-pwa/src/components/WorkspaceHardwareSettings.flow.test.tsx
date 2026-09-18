import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

// The real ResolveWorkspaceAdminDialog runs here (unlike WorkspaceHardwareSettings.test.tsx,
// which mocks it) - this is the closing-then-opening sequence exactly as Marco hit it live:
// the closing band is cached on this device, the opening band isn't. Found live: the second
// dialog's PIN step sent nothing to the server and showed no error.
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { WorkspaceHardwareSettings } = await import('./WorkspaceHardwareSettings')

const serverBands = [
  { workspaceId: 'band-a', workspaceName: 'Abadschendaler' },
  { workspaceId: 'band-b', workspaceName: 'SOAT' },
]
const rosterFor = (id: string) => ({
  workspaceId: id,
  workspaceName: id === 'band-a' ? 'Abadschendaler' : 'SOAT',
  members: [{ profileId: `${id}-admin`, name: `Admin ${id}`, isAdmin: true }],
})

describe('WorkspaceHardwareSettings - closing (cached) then opening (not cached)', () => {
  const activateProfile = vi.fn()
  const resolveMemberCredentials = vi.fn()
  const activateWorkspaceHardware = vi.fn()

  beforeEach(() => {
    activateProfile.mockReset().mockResolvedValue({ id: 'band-a', name: 'A', username: 'a-user', couchPassword: 'a-pw' })
    resolveMemberCredentials.mockReset().mockResolvedValue({ id: 'band-b', name: 'B', username: 'b-user', couchPassword: 'b-pw' })
    activateWorkspaceHardware.mockReset().mockResolvedValue(true)
    useWorkspaceStore.setState({
      // Only Abadschendaler is cached as an admin on this device - SOAT isn't.
      workspaces: [{ id: 'band-a', name: 'Abadschendaler', isAdmin: true, username: 'x', couchPassword: 'y' }],
      activeWorkspaceId: 'band-a',
      listWorkspaces: vi.fn().mockResolvedValue(serverBands),
      fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: 'band-a' }),
      fetchServerInfo: vi.fn().mockResolvedValue({ lanIp: '1.2.3.4', hostname: 'stageboard.local' }),
      getAccessCode: vi.fn().mockResolvedValue({ code: '11112222' }),
      fetchRoster: vi.fn().mockImplementation(async (id: string) => rosterFor(id)),
      activateProfile,
      resolveMemberCredentials,
      activateWorkspaceHardware,
    })
  })

  it('resolves the opening band via resolveMemberCredentials, not the closing band\'s cached-credentials path', async () => {
    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('SOAT')).toBeInTheDocument())
    fireEvent.click(screen.getByText('SOAT').closest('button')!)

    // Closing dialog (Abadschendaler): cached, so no code step - straight to the admin picker.
    await waitFor(() => expect(screen.getByText('Admin band-a')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Admin band-a'))
    fireEvent.change(await screen.findByPlaceholderText('4-stelliger PIN'), { target: { value: '1111' } })
    fireEvent.click(screen.getByText('Bestätigen'))
    await waitFor(() => expect(activateProfile).toHaveBeenCalledWith('band-a', 'band-a-admin', '1111'))

    // Opening dialog (SOAT): not cached, so it must ask for the code first.
    fireEvent.change(await screen.findByPlaceholderText('12345678'), { target: { value: '99512679' } })
    fireEvent.click(screen.getByText('Weiter'))
    await waitFor(() => expect(screen.getByText('Admin band-b')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Admin band-b'))
    fireEvent.change(await screen.findByPlaceholderText('4-stelliger PIN'), { target: { value: '2222' } })
    fireEvent.click(screen.getByText('Bestätigen'))

    await waitFor(() => expect(resolveMemberCredentials).toHaveBeenCalledWith('band-b', 'SOAT', '99512679', 'band-b-admin', '2222'))
    expect(activateProfile).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(activateWorkspaceHardware).toHaveBeenCalledWith('band-b', 'b-user', 'b-pw', 'a-user', 'a-pw'),
    )
  })
})
