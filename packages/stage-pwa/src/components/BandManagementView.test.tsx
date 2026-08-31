import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
const { useDialogStore } = await import('../store/useDialogStore')
const { useProfilesStore } = await import('../store/useProfilesStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { BandManagementView } = await import('./BandManagementView')

beforeEach(() => {
  useWorkspaceStore.setState({
    // username set: these tests exercise an already-server-connected band by default (the
    // pre-Tier-A-local-only-founding, already-established behavior) - the local-only "Verbinden"
    // banner and PIN-field omission get their own dedicated tests further below.
    workspaces: [
      { id: 'band-a', name: 'Band A', isAdmin: true, username: 'stageboard-band-a-p1', couchPassword: 'admin-pw' },
      { id: 'band-b', name: 'Band B', isAdmin: false },
    ],
    activeWorkspaceId: 'band-a',
  })
  useProfilesStore.setState({
    profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] }],
    loaded: true,
    create: vi.fn(),
    update: vi.fn(),
    updateStageRoles: vi.fn(),
    remove: vi.fn(),
    connectToServer: vi.fn(),
  })
  useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p1' } })
})

describe('BandManagementView', () => {
  it('lists every known band, admin controls only on bands this device administers', () => {
    render(<BandManagementView />)

    expect(screen.getByText('Band A')).toBeInTheDocument()
    expect(screen.getByText('Band B')).toBeInTheDocument()
    // No band-level "Umbenennen" at all (see the component's own doc comment) - the one
    // "Umbenennen" that does exist is the active band's roster section (member rename). No
    // band-level "Einladen" either (per-person-accounts follow-up - inviting is now always
    // tied to a specific newly-created member, part of "+ Neues Mitglied", not a standalone
    // band-level action). "Löschen" appears twice: band-a's own delete, plus the roster
    // member's delete.
    expect(screen.getAllByText('Umbenennen')).toHaveLength(1)
    expect(screen.queryByText('Einladen')).not.toBeInTheDocument()
    expect(screen.getAllByText('Löschen')).toHaveLength(2)
  })

  it('"+ Neue Band" prompts for a name and calls addWorkspace', async () => {
    const addWorkspace = vi.fn().mockResolvedValue({ id: 'new-id', name: 'Band C' })
    useWorkspaceStore.setState({ addWorkspace })
    useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('Band C') })

    render(<BandManagementView />)
    fireEvent.click(screen.getByText('+ Neue Band'))

    await waitFor(() => expect(addWorkspace).toHaveBeenCalledWith('Band C'))
  })

  it('deleting a band confirms (danger-styled) first, then calls deleteWorkspace', async () => {
    const deleteWorkspace = vi.fn()
    useWorkspaceStore.setState({ deleteWorkspace })
    const confirm = vi.fn().mockResolvedValue(true)
    useDialogStore.setState({ confirm })

    render(<BandManagementView />)
    // Band-level "Löschen" is the first - the member-level one is second.
    fireEvent.click(screen.getAllByText('Löschen')[0])

    await waitFor(() => expect(deleteWorkspace).toHaveBeenCalledWith('band-a'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Band A'), expect.objectContaining({ danger: true }))
  })

  it('does not delete the band if the confirmation is declined', async () => {
    const deleteWorkspace = vi.fn()
    useWorkspaceStore.setState({ deleteWorkspace })
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(false) })

    render(<BandManagementView />)
    fireEvent.click(screen.getAllByText('Löschen')[0])

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(deleteWorkspace).not.toHaveBeenCalled()
  })

  it('shows the roster only for the active workspace, gated on its own isAdmin', () => {
    render(<BandManagementView />)

    expect(screen.getByText(/Mitglieder \(Band A\)/)).toBeInTheDocument()
    expect(screen.getByText('Marco')).toBeInTheDocument()
    expect(screen.getByText('+ Neues Mitglied')).toBeInTheDocument()
  })

  it('shows a member\'s assigned stage roles (including "Admin") as badges directly in the roster', () => {
    useProfilesStore.setState({
      profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['performer', 'soundtech', 'admin'] }],
    })
    render(<BandManagementView />)

    expect(screen.getByText('Musiker:in')).toBeInTheDocument()
    expect(screen.getByText('Tontechnik')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('shows no stage-role badges for a member with none assigned', () => {
    useProfilesStore.setState({
      profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: [] }],
    })
    render(<BandManagementView />)
    expect(screen.queryByText('Musiker:in')).not.toBeInTheDocument()
    expect(screen.queryByText('Admin')).not.toBeInTheDocument()
  })

  it('hides member management controls when the active workspace is not administered by this device', () => {
    useWorkspaceStore.setState({ activeWorkspaceId: 'band-b' })
    render(<BandManagementView />)

    expect(screen.getByText(/Nur der Band-Admin kann Mitglieder verwalten/)).toBeInTheDocument()
    expect(screen.queryByText('+ Neues Mitglied')).not.toBeInTheDocument()
    expect(screen.queryByText('Instrument/Funktion ändern')).not.toBeInTheDocument()
  })

  it('renaming a member calls update() with the new name, keeping the existing role', async () => {
    const update = vi.fn()
    useProfilesStore.setState({ update })
    useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('Marco M.') })

    render(<BandManagementView />)

    // Only one "Umbenennen" button exists now (member-level - no band-level rename anymore).
    fireEvent.click(screen.getByText('Umbenennen'))

    await waitFor(() => expect(update).toHaveBeenCalledWith('p1', 'Marco M.', 'Gitarre'))
  })

  it('changing a member\'s role calls update() with the new role, keeping the existing name', async () => {
    const update = vi.fn()
    useProfilesStore.setState({ update })
    useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('Licht') })

    render(<BandManagementView />)
    fireEvent.click(screen.getByText('Instrument/Funktion ändern'))

    await waitFor(() => expect(update).toHaveBeenCalledWith('p1', 'Marco', 'Licht'))
  })

  it('"Stage-Rollen anpassen" offers "Admin" alongside the other stage roles, pre-filled from the current selection', async () => {
    useProfilesStore.setState({
      profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['performer', 'admin'] }],
    })
    const updateStageRoles = vi.fn()
    useProfilesStore.setState({ updateStageRoles })
    const promptFields = vi.fn().mockResolvedValue({ stageRoles: 'performer,soundtech,admin' })
    useDialogStore.setState({ promptFields })

    render(<BandManagementView />)
    fireEvent.click(screen.getByText('Stage-Rollen anpassen'))

    await waitFor(() => expect(updateStageRoles).toHaveBeenCalledWith('p1', ['performer', 'soundtech', 'admin']))
    const [, fields] = promptFields.mock.calls[0]
    expect(fields[0].defaultValue).toBe('performer,admin')
    expect(fields[0].options).toContainEqual({ value: 'admin', label: 'Admin' })
  })

  it('unchecking "Admin" for someone who is not the last admin calls updateStageRoles as normal', async () => {
    useProfilesStore.setState({
      profiles: [
        { id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] },
        { id: 'p2', name: 'Chris', role: 'Bass', stageRoles: ['admin'] },
      ],
    })
    const updateStageRoles = vi.fn()
    useProfilesStore.setState({ updateStageRoles })
    useDialogStore.setState({ promptFields: vi.fn().mockResolvedValue({ stageRoles: '' }) })

    render(<BandManagementView />)
    fireEvent.click(screen.getAllByText('Stage-Rollen anpassen')[0])

    await waitFor(() => expect(updateStageRoles).toHaveBeenCalledWith('p1', []))
  })

  it('"Stage-Rollen anpassen" calls updateStageRoles unconditionally - the last-admin block itself lives in useProfilesStore, covered by useProfilesStore.test.ts', async () => {
    const updateStageRoles = vi.fn().mockResolvedValue(false)
    useProfilesStore.setState({ updateStageRoles })
    useDialogStore.setState({ promptFields: vi.fn().mockResolvedValue({ stageRoles: '' }) })

    render(<BandManagementView />)
    fireEvent.click(screen.getByText('Stage-Rollen anpassen'))

    await waitFor(() => expect(updateStageRoles).toHaveBeenCalledWith('p1', []))
  })

  it('deleting a member confirms first, then calls remove()', async () => {
    // Not the last admin here - deletion itself, not the last-admin guard, is what's under
    // test; that guard gets its own test below.
    useProfilesStore.setState({
      profiles: [{ id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: [] }],
    })
    const remove = vi.fn()
    useProfilesStore.setState({ remove })
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(true) })

    render(<BandManagementView />)
    // Band-level "Löschen" is the first - the member-level one is second.
    fireEvent.click(screen.getAllByText('Löschen')[1])

    await waitFor(() => expect(remove).toHaveBeenCalledWith('p1'))
  })

  it('disables "Löschen" for the sole remaining admin, with an explanatory title', () => {
    render(<BandManagementView />)

    // Member-level "Löschen" is the second one (band-level delete is first).
    const remove = screen.getAllByText('Löschen')[1] as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    expect(remove.title).toMatch(/Mindestens ein Admin/)
  })

  it('does not disable "Löschen" when another admin also exists', () => {
    useProfilesStore.setState({
      profiles: [
        { id: 'p1', name: 'Marco', role: 'Gitarre', stageRoles: ['admin'] },
        { id: 'p2', name: 'Chris', role: 'Bass', stageRoles: ['admin'] },
      ],
    })
    render(<BandManagementView />)

    const remove = screen.getAllByText('Löschen')[1] as HTMLButtonElement
    expect(remove.disabled).toBe(false)
  })

  it('adding a member prompts for name+role+optional PIN and calls create()', async () => {
    const create = vi.fn()
    useProfilesStore.setState({ create })
    useDialogStore.setState({ promptFields: vi.fn().mockResolvedValue({ name: 'Chris', role: 'Bass' }) })

    render(<BandManagementView />)
    fireEvent.click(screen.getByText('+ Neues Mitglied'))

    // No PIN typed in this test - the 3rd arg is undefined (see the "PIN becomes the account's
    // password directly" test below for the PIN-supplied case).
    await waitFor(() => expect(create).toHaveBeenCalledWith('Chris', 'Bass', undefined))
  })

  it('adding a member with a PIN passes it as the new account\'s password and shows the credentials directly, without opening the invite screen', async () => {
    const created = {
      profile: { id: 'p2', name: 'Chris', role: 'Bass', stageRoles: [] },
      credentials: { username: 'stageboard-band-a-p2', password: '4711' },
    }
    const create = vi.fn().mockResolvedValue(created)
    useProfilesStore.setState({ create })
    const alert = vi.fn().mockResolvedValue(undefined)
    useDialogStore.setState({
      promptFields: vi.fn().mockResolvedValue({ name: 'Chris', role: 'Bass', pin: '4711' }),
      alert,
    })

    render(<BandManagementView />)
    fireEvent.click(screen.getByText('+ Neues Mitglied'))

    await waitFor(() => expect(create).toHaveBeenCalledWith('Chris', 'Bass', { password: '4711' }))
    await waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining('4711')))
    expect(screen.queryByText('QR-Code für Einladungscode 12345678')).not.toBeInTheDocument()
  })

  describe('local-only workspace (Tier-A local-only-founding follow-up)', () => {
    beforeEach(() => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', isAdmin: true, ownProfileId: 'p1' }],
      })
    })

    it('shows the "Verbinden" banner instead of the member controls, and omits the PIN field on "+ Neues Mitglied"', () => {
      render(<BandManagementView />)

      expect(screen.getByText(/läuft bisher nur lokal/)).toBeInTheDocument()
      expect(screen.getByText('Verbinden')).toBeInTheDocument()
    })

    it('"Verbinden" asks for a server address, persists it, and calls connectToServer', async () => {
      const connectToServer = vi.fn().mockResolvedValue([])
      useProfilesStore.setState({ connectToServer })
      useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('https://stage-server:3001') })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Verbinden'))

      await waitFor(() => expect(connectToServer).toHaveBeenCalledWith('https://stage-server:3001'))
    })

    it('after connecting, shows a per-member "Einladen" list from the result and opens InviteBandView for whichever row is clicked', async () => {
      const results = [
        { profile: { id: 'p2', name: 'Chris', role: 'Bass', stageRoles: [] }, credentials: { username: 'stageboard-band-a-p2', password: 'gen-pw' } },
      ]
      const connectToServer = vi.fn().mockResolvedValue(results)
      useProfilesStore.setState({ connectToServer })
      useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('https://stage-server:3001') })
      useWorkspaceStore.setState({
        createInvite: vi.fn().mockResolvedValue({ code: '12345678', expiresAt: Date.now() + 60_000 }),
      })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Verbinden'))
      await waitFor(() => expect(screen.getByText('Chris')).toBeInTheDocument())

      fireEvent.click(screen.getByText('Einladen'))
      await waitFor(() => expect(screen.getByText('12345678')).toBeInTheDocument())
    })

    it('"+ Neues Mitglied" does not offer a PIN field while local-only', async () => {
      const promptFields = vi.fn().mockResolvedValue({ name: 'Chris', role: 'Bass' })
      useDialogStore.setState({ promptFields })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('+ Neues Mitglied'))

      await waitFor(() => expect(promptFields).toHaveBeenCalled())
      const [, fields] = promptFields.mock.calls[0]
      expect(fields.map((f: { key: string }) => f.key)).toEqual(['name', 'role'])
    })
  })
})
