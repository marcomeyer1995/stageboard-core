import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// useProfilesStore transitively imports workspaceDb.ts, which constructs a real PouchDB at
// module load time - unavailable under happy-dom (see workspaceDb.test.ts's identical mock,
// and ProfileSwitcher.test.tsx's use of the same pattern for the same reason).
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
const { ProfileRolePickerView } = await import('./ProfileRolePickerView')

function seedStores() {
  useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
  useProfilesStore.setState({
    profiles: [
      { id: 'p1', name: 'Marco', stageRoles: [] },
      { id: 'p2', name: 'Chris', stageRoles: [] },
    ],
    loaded: true,
  })
  useActiveProfileStore.setState({ byWorkspace: {} })
}

describe('ProfileRolePickerView', () => {
  it('lists every roster profile by name', () => {
    seedStores()
    render(<ProfileRolePickerView />)

    expect(screen.getByText('Marco')).toBeInTheDocument()
    expect(screen.getByText('Chris')).toBeInTheDocument()
  })

  it('picking a profile activates it for the current workspace', () => {
    seedStores()
    render(<ProfileRolePickerView />)

    fireEvent.click(screen.getByText('Marco'))

    expect(useActiveProfileStore.getState().byWorkspace['band-a']).toBe('p1')
  })

  it('"Ohne Profil fortfahren" sets an explicit empty choice, not just leaving it undecided', () => {
    seedStores()
    render(<ProfileRolePickerView />)

    fireEvent.click(screen.getByText('Ohne Profil fortfahren'))

    // Must be '' (explicitly decided), not absent - an absent key is exactly what makes this
    // screen show in the first place (see App.tsx's gate), so this has to actually dismiss it.
    expect(useActiveProfileStore.getState().byWorkspace['band-a']).toBe('')
  })

  it('shows a message instead of an empty list when the roster has no members yet', () => {
    seedStores()
    useProfilesStore.setState({ profiles: [] })
    render(<ProfileRolePickerView />)

    expect(screen.getByText(/Noch keine Profile angelegt/)).toBeInTheDocument()
  })
})
