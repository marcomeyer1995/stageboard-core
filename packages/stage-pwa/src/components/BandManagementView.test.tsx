import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const { usePresenceStore } = await import('../store/usePresenceStore')
const { useProfilesStore } = await import('../store/useProfilesStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { BandManagementView } = await import('./BandManagementView')

// "Einladen" opens InviteBandView.tsx, whose fetchLanIp() would otherwise pick up the real
// .env's VITE_STAGE_SERVER_URL and make a live, self-signed-cert network call no test here
// cares about - see InviteBandView.test.tsx's identical stub.
afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.stubEnv('VITE_STAGE_SERVER_URL', '')
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
    profiles: [{ id: 'p1', name: 'Marco', stageRoles: ['admin'] }],
    loaded: true,
    create: vi.fn(),
    update: vi.fn(),
    updateStageRoles: vi.fn(),
    remove: vi.fn(),
    connectToServer: vi.fn(),
  })
  useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p1' } })
  usePresenceStore.setState({ presence: { devices: {} } })
})

describe('BandManagementView', () => {
  it('lists every known band, admin controls only on bands this device administers', () => {
    render(<BandManagementView />)

    expect(screen.getByText('Band A')).toBeInTheDocument()
    expect(screen.getByText('Band B')).toBeInTheDocument()
    // No band-level "Umbenennen" at all (see the component's own doc comment) - the one
    // "Umbenennen" that does exist is the active band's roster section (member rename). One
    // band-level "Einladen" (2026-09-01 redesign, next to the band's own name/Löschen - not
    // per roster row, not per new member) for the already-server-connected band-a; band-b is
    // this device's non-admin band, so it gets neither. "Löschen" appears twice: band-a's own
    // delete, plus the roster member's delete.
    expect(screen.getAllByText('Umbenennen')).toHaveLength(1)
    expect(screen.getByText('Einladen')).toBeInTheDocument()
    expect(screen.getAllByText('Löschen')).toHaveLength(2)
  })

  it('does not offer "Einladen" for a band that is still local-only (nothing to invite anyone to yet)', () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'band-a', name: 'Band A', isAdmin: true, ownProfileId: 'p1' },
        { id: 'band-b', name: 'Band B', isAdmin: false },
      ],
    })
    render(<BandManagementView />)
    expect(screen.queryByText('Einladen')).not.toBeInTheDocument()
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

  it('highlights the active band with the same accent treatment as the active profile row, and no other band', () => {
    render(<BandManagementView />)

    const activeBandRow = screen.getByText('Band A').closest('div.rounded-sb')
    const otherBandRow = screen.getByText('Band B').closest('div.rounded-sb')
    expect(activeBandRow?.className).toMatch(/border-accent/)
    expect(otherBandRow?.className).not.toMatch(/border-accent/)
  })

  it('shows the roster only for the active workspace, gated on its own isAdmin', () => {
    render(<BandManagementView />)

    expect(screen.getByText(/Mitglieder \(Band A\)/)).toBeInTheDocument()
    expect(screen.getByText('Marco')).toBeInTheDocument()
    expect(screen.getByText('+ Neues Mitglied')).toBeInTheDocument()
  })

  it('shows a member\'s assigned stage roles (including "Admin") as badges directly in the roster', () => {
    useProfilesStore.setState({
      profiles: [{ id: 'p1', name: 'Marco', stageRoles: ['performer', 'soundtech', 'admin'] }],
    })
    render(<BandManagementView />)

    expect(screen.getByText('Musiker:in')).toBeInTheDocument()
    expect(screen.getByText('Tontechnik')).toBeInTheDocument()
    expect(screen.getByText('Admin')).toBeInTheDocument()
  })

  it('shows no stage-role badges for a member with none assigned', () => {
    useProfilesStore.setState({
      profiles: [{ id: 'p1', name: 'Marco', stageRoles: [] }],
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
  })

  it('renaming a member calls update() with the new name', async () => {
    const update = vi.fn()
    useProfilesStore.setState({ update })
    useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('Marco M.') })

    render(<BandManagementView />)

    // Only one "Umbenennen" button exists now (member-level - no band-level rename anymore).
    fireEvent.click(screen.getByText('Umbenennen'))

    await waitFor(() => expect(update).toHaveBeenCalledWith('p1', 'Marco M.'))
  })

  it('2026-09-02 sixth follow-up: "Instrument/Funktion ändern" no longer exists - role/instrument was removed entirely ("I don\'t see the necessity for it")', () => {
    render(<BandManagementView />)
    expect(screen.queryByText('Instrument/Funktion ändern')).not.toBeInTheDocument()
  })

  it('"Stage-Rollen anpassen" offers "Admin" alongside the other stage roles, pre-filled from the current selection', async () => {
    useProfilesStore.setState({
      profiles: [{ id: 'p1', name: 'Marco', stageRoles: ['performer', 'admin'] }],
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
        { id: 'p1', name: 'Marco', stageRoles: ['admin'] },
        { id: 'p2', name: 'Chris', stageRoles: ['admin'] },
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
      profiles: [{ id: 'p1', name: 'Marco', stageRoles: [] }],
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
        { id: 'p1', name: 'Marco', stageRoles: ['admin'] },
        { id: 'p2', name: 'Chris', stageRoles: ['admin'] },
      ],
    })
    render(<BandManagementView />)

    const remove = screen.getAllByText('Löschen')[1] as HTMLButtonElement
    expect(remove.disabled).toBe(false)
  })

  describe('presence indicators (2026-09-02 ninth follow-up: who is logged in, and from how many devices)', () => {
    beforeEach(() => {
      useProfilesStore.setState({
        profiles: [
          { id: 'p1', name: 'Marco', stageRoles: ['admin'] },
          { id: 'p2', name: 'Chris', stageRoles: [] },
        ],
      })
    })

    it('shows a green dot for a profile with at least one device online', () => {
      usePresenceStore.setState({ presence: { devices: { 'device-1': { profileId: 'p1', lastSeenAt: Date.now() } } } })

      render(<BandManagementView />)

      expect(screen.getByTitle('1 Gerät gerade angemeldet')).toBeInTheDocument()
    })

    it('shows no dot for a profile with no device reporting it', () => {
      usePresenceStore.setState({ presence: { devices: {} } })

      render(<BandManagementView />)

      expect(screen.queryByTitle(/gerade angemeldet/)).not.toBeInTheDocument()
    })

    it('shows a ×N count when the same profile is online from more than one device', () => {
      usePresenceStore.setState({
        presence: {
          devices: {
            'device-1': { profileId: 'p1', lastSeenAt: Date.now() },
            'device-2': { profileId: 'p1', lastSeenAt: Date.now() },
          },
        },
      })

      render(<BandManagementView />)

      expect(screen.getByTitle('2 Geräte gerade angemeldet')).toBeInTheDocument()
      expect(screen.getByText('×2')).toBeInTheDocument()
    })

    it('treats a stale entry (older than PRESENCE_TIMEOUT_MS) as offline, not online', () => {
      usePresenceStore.setState({
        presence: { devices: { 'device-1': { profileId: 'p1', lastSeenAt: Date.now() - 60_000 } } },
      })

      render(<BandManagementView />)

      expect(screen.queryByTitle(/gerade angemeldet/)).not.toBeInTheDocument()
    })

    it('highlights the row for this device\'s own active profile, independent of presence', () => {
      useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p2' } })
      usePresenceStore.setState({ presence: { devices: {} } })

      render(<BandManagementView />)

      expect(screen.getByText('(du)').closest('div.rounded-sb')?.className).toMatch(/border-accent/)
    })
  })

  describe('"Passwort zurücksetzen" (2026-09-02 follow-up: admin-side reset, since self-service blank-password recovery is refused for admin accounts)', () => {
    it('confirms first, then resets and shows the fresh password once', async () => {
      const resetMemberPassword = vi.fn().mockResolvedValue({ username: 'stageboard-band-a-p1', password: 'fresh-123' })
      useWorkspaceStore.setState({ resetMemberPassword })
      const confirmMock = vi.fn().mockResolvedValue(true)
      const alertMock = vi.fn().mockResolvedValue(undefined)
      useDialogStore.setState({ confirm: confirmMock, alert: alertMock })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Passwort zurücksetzen'))

      await waitFor(() => expect(resetMemberPassword).toHaveBeenCalledWith('band-a', 'p1'))
      expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('Marco'), expect.objectContaining({ danger: true }))
      expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('fresh-123'), expect.objectContaining({ title: 'PIN zurückgesetzt' }))
    })

    it('does not reset when the confirmation is declined', async () => {
      const resetMemberPassword = vi.fn()
      useWorkspaceStore.setState({ resetMemberPassword })
      useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(false) })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Passwort zurücksetzen'))

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(resetMemberPassword).not.toHaveBeenCalled()
    })

    it('shows no success alert when resetMemberPassword fails (the store itself already alerted why)', async () => {
      const resetMemberPassword = vi.fn().mockResolvedValue(null)
      useWorkspaceStore.setState({ resetMemberPassword })
      const alertMock = vi.fn().mockResolvedValue(undefined)
      useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(true), alert: alertMock })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Passwort zurücksetzen'))

      await waitFor(() => expect(resetMemberPassword).toHaveBeenCalled())
      expect(alertMock).not.toHaveBeenCalled()
    })
  })

  it('2026-09-02 sixth follow-up: adding a member prompts for just a name (role/PIN both gone entirely) and calls create()', async () => {
    const create = vi.fn()
    useProfilesStore.setState({ create })
    useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('Chris') })

    render(<BandManagementView />)
    fireEvent.click(screen.getByText('+ Neues Mitglied'))

    await waitFor(() => expect(create).toHaveBeenCalledWith('Chris'))
    expect(screen.queryByText('Band einladen')).not.toBeInTheDocument()
  })

  describe('"Einladen" (2026-09-01 redesign: one band-level, standing WiFi-style code)', () => {
    it('shows the standing workspace access code (no member picker, no password, no minting)', async () => {
      const getAccessCode = vi.fn().mockResolvedValue({ code: '11112222' })
      useWorkspaceStore.setState({ getAccessCode })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Einladen'))

      await waitFor(() => expect(screen.getByText('11112222')).toBeInTheDocument())
      expect(getAccessCode).toHaveBeenCalledWith('band-a')
    })

    it('"Schließen" closes the invite screen', async () => {
      useWorkspaceStore.setState({
        getAccessCode: vi.fn().mockResolvedValue({ code: '11112222' }),
      })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Einladen'))
      await waitFor(() => expect(screen.getByText('11112222')).toBeInTheDocument())

      fireEvent.click(screen.getByText('Schließen'))
      expect(screen.queryByText('11112222')).not.toBeInTheDocument()
    })
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

    it('"Verbinden" asks for a server address, persists it, and calls connectToServer - no per-member follow-up anymore (2026-09-01 redesign)', async () => {
      const connectToServer = vi.fn().mockResolvedValue(true)
      useProfilesStore.setState({ connectToServer })
      useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('https://stage-server:3001') })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Verbinden'))

      await waitFor(() => expect(connectToServer).toHaveBeenCalledWith('https://stage-server:3001'))
      // No "Verbunden. Jetzt die restlichen Mitglieder..." list anymore - self-service join
      // (the band-level "Einladen" code) covers every already-typed-in member instead.
      expect(screen.queryByText(/Jetzt die restlichen Mitglieder/)).not.toBeInTheDocument()
    })

    it('"+ Neues Mitglied" still works while local-only - just a name, same as connected', async () => {
      const create = vi.fn()
      useProfilesStore.setState({ create })
      useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('Chris') })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('+ Neues Mitglied'))

      await waitFor(() => expect(create).toHaveBeenCalledWith('Chris'))
    })
  })

  describe('switching bands and members (2026-09-02 follow-up: moved here from the removed AppMenu.tsx "Wer bin ich" section)', () => {
    it('clicking a band\'s name makes it active', () => {
      const setActiveWorkspace = vi.fn()
      useWorkspaceStore.setState({ setActiveWorkspace })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Band B'))

      expect(setActiveWorkspace).toHaveBeenCalledWith('band-b')
    })

    it('disables the already-active band\'s own name button', () => {
      render(<BandManagementView />)

      const activeBandButton = screen.getByText('Band A').closest('button') as HTMLButtonElement
      expect(activeBandButton.disabled).toBe(true)
    })

    it('a local-only band (no Stage-Server account) switches the active profile immediately, with no code prompt at all', () => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', isAdmin: true, ownProfileId: 'p1' }],
      })
      useProfilesStore.setState({
        profiles: [
          { id: 'p1', name: 'Marco', stageRoles: ['admin'] },
          { id: 'p2', name: 'Chris', stageRoles: [] },
        ],
      })
      const setActive = vi.fn()
      useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p1' }, setActive })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Auswählen'))

      expect(setActive).toHaveBeenCalledWith('band-a', 'p2')
      expect(screen.queryByPlaceholderText('4-stelliger Code')).not.toBeInTheDocument()
    })

    describe('once connected to a Stage-Server', () => {
      beforeEach(() => {
        useProfilesStore.setState({
          profiles: [
            { id: 'p1', name: 'Marco', stageRoles: ['admin'] },
            { id: 'p2', name: 'Chris', stageRoles: [] },
            { id: 'p3', name: 'Jonas', stageRoles: ['admin'] },
          ],
        })
      })

      it('does not show "Auswählen" for the already-active profile', () => {
        render(<BandManagementView />)

        // Marco (p1) is the active profile by default (see the file's top-level beforeEach) -
        // only Chris and Jonas should offer "Auswählen".
        expect(screen.getAllByText('Auswählen')).toHaveLength(2)
      })

      it('2026-09-02 second follow-up: picking a non-admin member activates it immediately, with no code prompt at all', async () => {
        const activateProfile = vi.fn().mockResolvedValue({ id: 'band-a', name: 'Band A' })
        const setActive = vi.fn()
        useWorkspaceStore.setState({ activateProfile })
        useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p1' }, setActive })

        render(<BandManagementView />)
        fireEvent.click(screen.getAllByText('Auswählen')[0]) // Chris (p2), the non-admin one

        await waitFor(() => expect(activateProfile).toHaveBeenCalledWith('band-a', 'p2', undefined))
        await waitFor(() => expect(setActive).toHaveBeenCalledWith('band-a', 'p2'))
        expect(screen.queryByPlaceholderText('4-stelliger Code')).not.toBeInTheDocument()
      })

      it('picking an admin member opens an inline 4-digit code prompt instead of switching immediately', () => {
        render(<BandManagementView />)

        fireEvent.click(screen.getAllByText('Auswählen')[1]) // Chris, Jonas - Jonas is the admin

        expect(screen.getByPlaceholderText('4-stelliger Code')).toBeInTheDocument()
      })

      it('submitting the code calls activateProfile, and activates the picked profile locally on success', async () => {
        const activateProfile = vi.fn().mockResolvedValue({ id: 'band-a', name: 'Band A' })
        const setActive = vi.fn()
        useWorkspaceStore.setState({ activateProfile })
        useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p1' }, setActive })

        render(<BandManagementView />)
        fireEvent.click(screen.getAllByText('Auswählen')[1])
        fireEvent.change(screen.getByPlaceholderText('4-stelliger Code'), { target: { value: '4711' } })
        fireEvent.click(screen.getByRole('button', { name: 'Wechseln' }))

        await waitFor(() => expect(activateProfile).toHaveBeenCalledWith('band-a', 'p3', '4711'))
        await waitFor(() => expect(setActive).toHaveBeenCalledWith('band-a', 'p3'))
      })

      it('strips non-digit characters, caps the code at 4 digits, and disables submit until then', () => {
        render(<BandManagementView />)
        fireEvent.click(screen.getAllByText('Auswählen')[1])

        const input = screen.getByPlaceholderText('4-stelliger Code') as HTMLInputElement
        fireEvent.change(input, { target: { value: '47-11 22' } })
        expect(input.value).toBe('4711')
        expect(screen.getByRole('button', { name: 'Wechseln' })).not.toBeDisabled()

        fireEvent.change(input, { target: { value: '47' } })
        expect(screen.getByRole('button', { name: 'Wechseln' })).toBeDisabled()
      })

      it('"Abbrechen" closes the code prompt without calling activateProfile', () => {
        const activateProfile = vi.fn()
        useWorkspaceStore.setState({ activateProfile })

        render(<BandManagementView />)
        fireEvent.click(screen.getAllByText('Auswählen')[1])
        fireEvent.click(screen.getByText('Abbrechen'))

        expect(screen.queryByPlaceholderText('4-stelliger Code')).not.toBeInTheDocument()
        expect(activateProfile).not.toHaveBeenCalled()
      })

      it('does not activate the profile locally when activateProfile fails (the store itself already alerted why)', async () => {
        const activateProfile = vi.fn().mockResolvedValue(null)
        const setActive = vi.fn()
        useWorkspaceStore.setState({ activateProfile })
        useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p1' }, setActive })

        render(<BandManagementView />)
        fireEvent.click(screen.getAllByText('Auswählen')[1])
        fireEvent.change(screen.getByPlaceholderText('4-stelliger Code'), { target: { value: '4711' } })
        fireEvent.click(screen.getByRole('button', { name: 'Wechseln' }))

        await waitFor(() => expect(activateProfile).toHaveBeenCalled())
        expect(setActive).not.toHaveBeenCalled()
        // The prompt stays open for another attempt.
        expect(screen.getByPlaceholderText('4-stelliger Code')).toBeInTheDocument()
      })

      it('2026-09-02 third follow-up: the code prompt does not hint at the universal recovery code at all - that stays known only to Marco', () => {
        render(<BandManagementView />)
        fireEvent.click(screen.getAllByText('Auswählen')[1])

        expect(screen.queryByText(/letzten 4 Ziffern/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Band-Codes/)).not.toBeInTheDocument()
      })
    })
  })

  describe('"Meinen PIN setzen" (2026-09-02 second follow-up: admin self-service PIN assignment)', () => {
    it('is only offered for the currently-active admin profile', () => {
      useProfilesStore.setState({
        profiles: [
          { id: 'p1', name: 'Marco', stageRoles: ['admin'] },
          { id: 'p2', name: 'Chris', stageRoles: ['admin'] },
        ],
      })
      render(<BandManagementView />)

      // Marco (p1) is the active profile - only his row offers "Meinen PIN setzen", not Chris's
      // (a different admin, even though also admin).
      expect(screen.getAllByText('Meinen PIN setzen')).toHaveLength(1)
    })

    it('prompts for a new PIN, validates it, and calls setOwnPin', async () => {
      const setOwnPin = vi.fn().mockResolvedValue({ username: 'stageboard-band-a-p1', password: '9876' })
      useWorkspaceStore.setState({ setOwnPin })
      useDialogStore.setState({ promptFields: vi.fn().mockResolvedValue({ pin: '9876' }) })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Meinen PIN setzen'))

      await waitFor(() => expect(setOwnPin).toHaveBeenCalledWith('band-a', 'p1', '9876'))
    })

    it('rejects a PIN that is not exactly 4 digits, without calling setOwnPin', async () => {
      const setOwnPin = vi.fn()
      useWorkspaceStore.setState({ setOwnPin })
      const alertMock = vi.fn().mockResolvedValue(undefined)
      useDialogStore.setState({ promptFields: vi.fn().mockResolvedValue({ pin: '12345' }), alert: alertMock })

      render(<BandManagementView />)
      fireEvent.click(screen.getByText('Meinen PIN setzen'))

      await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('4 Ziffern')))
      expect(setOwnPin).not.toHaveBeenCalled()
    })
  })
})
