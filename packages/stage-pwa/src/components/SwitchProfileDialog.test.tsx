import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useProfilesStore } = await import('../store/useProfilesStore')
const { useActiveProfileStore } = await import('../store/useActiveProfileStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { useAppModeStore } = await import('../store/useAppModeStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { SwitchProfileDialog } = await import('./SwitchProfileDialog')

const activateProfile = vi.fn()
const confirm = vi.fn()

beforeEach(() => {
  activateProfile.mockReset().mockResolvedValue({ id: 'band' })
  confirm.mockReset().mockResolvedValue(false)
  useWorkspaceStore.setState({ workspaces: [{ id: 'band', name: 'Band', username: 'u', masterMode: 'device' }], activeWorkspaceId: 'band', activateProfile } as never)
  useProfilesStore.setState({
    profiles: [
      { id: 'marco', name: 'Marco', stageRoles: ['admin'] },
      { id: 'caro', name: 'Caro', stageRoles: [] },
    ],
  } as never)
  useActiveProfileStore.setState({ byWorkspace: { band: 'caro' } })
  useShowStateStore.setState({ isMaster: false } as never)
  useAppModeStore.setState({ mode: 'gig' } as never)
  useDialogStore.setState({ confirm } as never)
})

describe('SwitchProfileDialog ("Ich bin …" in ☰, Marco 2026-10-16)', () => {
  it('a member switches right away; an admin asks for the PIN', async () => {
    useActiveProfileStore.setState({ byWorkspace: { band: 'marco' } })
    const onClose = vi.fn()
    render(<SwitchProfileDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Caro' }))
    await waitFor(() => expect(activateProfile).toHaveBeenCalledWith('band', 'caro', undefined))
    expect(useActiveProfileStore.getState().byWorkspace.band).toBe('caro')

    render(<SwitchProfileDialog onClose={onClose} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Marco' }).slice(-1)[0])
    fireEvent.change(screen.getByLabelText('PIN von Marco'), { target: { value: '1234' } })
    fireEvent.click(screen.getByRole('button', { name: 'Wechseln' }))
    await waitFor(() => expect(activateProfile).toHaveBeenCalledWith('band', 'marco', '1234'))
  })

  it('warns only with "Master pro Person" while this device is master in Gig', async () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band', name: 'Band', username: 'u', masterMode: 'account' }] } as never)
    useShowStateStore.setState({ isMaster: true } as never)
    useActiveProfileStore.setState({ byWorkspace: { band: 'marco' } })
    render(<SwitchProfileDialog onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Caro' }))
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(activateProfile).not.toHaveBeenCalled()
  })
})
