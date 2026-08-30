import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// useProfilesStore transitively imports workspaceDb.ts, which constructs a real PouchDB at
// module load time - unavailable under happy-dom (see workspaceDb.test.ts's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useActiveProfileStore } = await import('../store/useActiveProfileStore')
const { useProfilesStore } = await import('../store/useProfilesStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { ProfileSwitcher } = await import('./ProfileSwitcher')

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
  useProfilesStore.setState({
    profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: [] }],
    loaded: true,
  })
  useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p1' } })
})

describe('ProfileSwitcher', () => {
  it('is a pure picker - lists the roster, no management controls', () => {
    render(<ProfileSwitcher />)

    expect(screen.getByRole('combobox')).toHaveValue('p1')
    expect(screen.getByText('Marco (Gitarre)')).toBeInTheDocument()
    // Creating/renaming/reassigning-a-role-to/deleting a member moved to SystemView's Band
    // tab (BandManagementView.tsx).
    expect(screen.queryByTitle('Neues Profil anlegen')).not.toBeInTheDocument()
    expect(screen.queryByText('Bearbeiten')).not.toBeInTheDocument()
    expect(screen.queryByText('Rolle ändern')).not.toBeInTheDocument()
    expect(screen.queryByText('Löschen')).not.toBeInTheDocument()
  })

  it('picking a profile calls setActive for the active workspace', () => {
    const setActive = vi.fn()
    useActiveProfileStore.setState({ setActive })
    render(<ProfileSwitcher />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '' } })

    expect(setActive).toHaveBeenCalledWith('band-a', null)
  })
})
