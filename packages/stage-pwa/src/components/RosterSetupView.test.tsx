import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { StageRole } from 'shared-types'

// useProfilesStore transitively imports workspaceDb.ts, which constructs a real PouchDB at
// module load time - unavailable under happy-dom (see workspaceDb.test.ts's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useDialogStore } = await import('../store/useDialogStore')
const { useProfilesStore } = await import('../store/useProfilesStore')
const { useRosterSetupStore } = await import('../store/useRosterSetupStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { RosterSetupView } = await import('./RosterSetupView')

function seedStores(profiles: Array<{ id: string; name: string; role: string; stageRoles?: StageRole[] }> = []) {
  useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
  useProfilesStore.setState({
    profiles: profiles.map((profile) => ({ ...profile, stageRoles: profile.stageRoles ?? [] })),
    loaded: true,
    create: vi.fn(),
    remove: vi.fn(),
  })
  useRosterSetupStore.setState({ completedFor: {} })
}

describe('RosterSetupView', () => {
  it('lists already-added members', () => {
    seedStores([{ id: 'p1', name: 'Marco', role: 'Gitarre' }])
    render(<RosterSetupView />)
    expect(screen.getByText('Marco')).toBeInTheDocument()
    expect(screen.getByText('(Gitarre)')).toBeInTheDocument()
  })

  it('adding a member calls create() and clears the form, without leaving this screen', async () => {
    const create = vi.fn()
    seedStores()
    useProfilesStore.setState({ create })

    render(<RosterSetupView />)
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Chris' } })
    fireEvent.change(screen.getByPlaceholderText(/Instrument\/Rolle/), { target: { value: 'Bass' } })
    fireEvent.click(screen.getByText('Hinzufügen'))

    await waitFor(() => expect(create).toHaveBeenCalledWith('Chris', 'Bass', undefined))
    await waitFor(() => expect((screen.getByPlaceholderText('Name') as HTMLInputElement).value).toBe(''))
  })

  it('"Weiter" marks roster setup complete for the active workspace', () => {
    seedStores()
    render(<RosterSetupView />)

    fireEvent.click(screen.getByText('Weiter'))

    expect(useRosterSetupStore.getState().completedFor['band-a']).toBe(true)
  })

  it('"Entfernen" calls remove() for that profile', () => {
    const remove = vi.fn()
    seedStores([{ id: 'p1', name: 'Marco', role: 'Gitarre' }])
    useProfilesStore.setState({ remove })

    render(<RosterSetupView />)
    fireEvent.click(screen.getByText('Entfernen'))

    expect(remove).toHaveBeenCalledWith('p1')
  })

  it('shows the just-typed band name in the heading', () => {
    seedStores()
    render(<RosterSetupView />)
    expect(screen.getByText('Wer ist alles bei Band A dabei?')).toBeInTheDocument()
  })

  it('"Bandnamen falsch eingegeben? Neu anfangen" confirms, then deletes the workspace (e.g. after a typo)', async () => {
    const deleteWorkspace = vi.fn()
    seedStores()
    useWorkspaceStore.setState({ deleteWorkspace })
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(true) })

    render(<RosterSetupView />)
    fireEvent.click(screen.getByText('Bandnamen falsch eingegeben? Neu anfangen'))

    await waitFor(() => expect(deleteWorkspace).toHaveBeenCalledWith('band-a'))
  })

  it('does not delete the workspace if the confirmation is declined', async () => {
    const deleteWorkspace = vi.fn()
    seedStores()
    useWorkspaceStore.setState({ deleteWorkspace })
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(false) })

    render(<RosterSetupView />)
    fireEvent.click(screen.getByText('Bandnamen falsch eingegeben? Neu anfangen'))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })
})
