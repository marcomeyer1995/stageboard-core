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

// 2026-09-02 tenth follow-up: per-member actions (Umbenennen, Löschen, ...) moved behind a
// single "⋮" popup per row (see the component's own doc comment) - opens it for a given
// member's name so the rest of a test can click straight through to an action inside.
function openMemberMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Weitere Optionen für ${name}` }))
}

// 2026-09-02 twelfth follow-up: the band list got the exact same "⋮" popup treatment.
function openBandMenu(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Weitere Optionen für ${name}` }))
}

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
    // Band-b is this device's non-admin band, so it gets no "⋮" at all. Band-a's own
    // "Einladen"/"Löschen" and the roster member's own Umbenennen/Löschen all live behind
    // their respective "⋮" popups now (2026-09-02 tenth/twelfth follow-ups).
    expect(screen.queryByRole('button', { name: 'Weitere Optionen für Band B' })).not.toBeInTheDocument()

    openBandMenu('Band A')
    expect(screen.getByText('Einladen')).toBeInTheDocument()
    expect(screen.getByText('Löschen')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Schließen'))

    openMemberMenu('Marco')
    expect(screen.getByText('Umbenennen')).toBeInTheDocument()
    expect(screen.getByText('Löschen')).toBeInTheDocument()
  })

  it('does not offer "Einladen" for a band that is still local-only (nothing to invite anyone to yet)', () => {
    useWorkspaceStore.setState({
      workspaces: [
        { id: 'band-a', name: 'Band A', isAdmin: true, ownProfileId: 'p1' },
        { id: 'band-b', name: 'Band B', isAdmin: false },
      ],
    })
    render(<BandManagementView />)
    openBandMenu('Band A')
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
    openBandMenu('Band A')
    fireEvent.click(screen.getByText('Löschen'))

    await waitFor(() => expect(deleteWorkspace).toHaveBeenCalledWith('band-a'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Band A'), expect.objectContaining({ danger: true }))
  })

  it('does not delete the band if the confirmation is declined', async () => {
    const deleteWorkspace = vi.fn()
    useWorkspaceStore.setState({ deleteWorkspace })
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(false) })

    render(<BandManagementView />)
    openBandMenu('Band A')
    fireEvent.click(screen.getByText('Löschen'))

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
    openMemberMenu('Marco')
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
    openMemberMenu('Marco')
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
    openMemberMenu('Marco')
    fireEvent.click(screen.getByText('Stage-Rollen anpassen'))

    await waitFor(() => expect(updateStageRoles).toHaveBeenCalledWith('p1', []))
  })

  it('"Stage-Rollen anpassen" calls updateStageRoles unconditionally - the last-admin block itself lives in useProfilesStore, covered by useProfilesStore.test.ts', async () => {
    const updateStageRoles = vi.fn().mockResolvedValue(false)
    useProfilesStore.setState({ updateStageRoles })
    useDialogStore.setState({ promptFields: vi.fn().mockResolvedValue({ stageRoles: '' }) })

    render(<BandManagementView />)
    openMemberMenu('Marco')
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
    openMemberMenu('Marco')
    fireEvent.click(screen.getByText('Löschen'))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('p1'))
  })

  it('disables "Löschen" for the sole remaining admin, with an explanatory title', () => {
    render(<BandManagementView />)

    openMemberMenu('Marco')
    const remove = screen.getByText('Löschen') as HTMLButtonElement
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

    openMemberMenu('Marco')
    const remove = screen.getByText('Löschen') as HTMLButtonElement
    expect(remove.disabled).toBe(false)
  })

  describe('per-member "⋮" actions popup (2026-09-02 tenth follow-up: replaces a row of inline text links that ran out of room on a phone)', () => {
    it('is not visible until "⋮" is clicked, and offers no popup at all for a viewer with nothing to do here', () => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', isAdmin: false, username: 'stageboard-band-a-p1', couchPassword: 'admin-pw' }],
      })
      useProfilesStore.setState({ profiles: [{ id: 'p1', name: 'Marco', stageRoles: [] }] })
      useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p2' } })

      render(<BandManagementView />)

      // A non-admin device viewing a non-active, non-self, non-admin profile has nothing to
      // offer on that *member's* row (no "Auswählen" link anymore either - that's the
      // tap-to-select on the row). The band itself still gets its own "⋮" (server-connected,
      // so "Von diesem Gerät entfernen" applies even to a non-admin member) - a separate
      // concern, not what this test is about.
      expect(screen.queryByRole('button', { name: 'Weitere Optionen für Marco' })).not.toBeInTheDocument()
    })

    it('"Schließen" dismisses the popup', () => {
      render(<BandManagementView />)

      openMemberMenu('Marco')
      expect(screen.getByText('Umbenennen')).toBeInTheDocument()
      fireEvent.click(screen.getByText('Schließen'))
      expect(screen.queryByText('Umbenennen')).not.toBeInTheDocument()
    })

    it('clicking the backdrop dismisses the popup, but clicking the card itself does not', () => {
      render(<BandManagementView />)
      openMemberMenu('Marco')

      const heading = screen.getByText('Marco', { selector: 'h3' })
      const card = heading.parentElement!
      const backdrop = card.parentElement!

      fireEvent.click(card)
      expect(screen.getByText('Umbenennen')).toBeInTheDocument()

      fireEvent.click(backdrop)
      expect(screen.queryByText('Umbenennen')).not.toBeInTheDocument()
    })

    it('closes itself once an action inside it is taken, rather than staying open under the action\'s own dialog', async () => {
      useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('Marco M.') })

      render(<BandManagementView />)
      openMemberMenu('Marco')
      fireEvent.click(screen.getByText('Umbenennen'))

      await waitFor(() => expect(screen.queryByText('Stage-Rollen anpassen')).not.toBeInTheDocument())
    })
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

      // p2 (Chris) is active - the accent border is the only "this is you" signal now
      // (2026-09-02 thirteenth follow-up: the "(du)" text label was redundant with it).
      const chrisRow = screen.getByText('Chris').closest('div.rounded-sb')
      const marcoRow = screen.getByText('Marco').closest('div.rounded-sb')
      expect(chrisRow?.className).toMatch(/border-accent/)
      expect(marcoRow?.className).not.toMatch(/border-accent/)
    })
  })

  describe('"Passwort zurücksetzen" (2026-09-02 follow-up: admin-side reset, since self-service blank-password recovery is refused for admin accounts)', () => {
    // A second admin (Chris, p2) who is NOT this device's active profile - Marco (p1, active)
    // never offers "Passwort zurücksetzen" on his own row (2026-09-02 eleventh follow-up,
    // found live: Marco locked his own phone out using it on himself - "Meinen PIN setzen" is
    // the only safe self-service path, see the dedicated test below).
    beforeEach(() => {
      useProfilesStore.setState({
        profiles: [
          { id: 'p1', name: 'Marco', stageRoles: ['admin'] },
          { id: 'p2', name: 'Chris', stageRoles: ['admin'] },
        ],
      })
    })

    it('is never offered on the currently-active profile\'s own row, even though it is an admin', () => {
      render(<BandManagementView />)
      openMemberMenu('Marco')
      expect(screen.queryByText('Passwort zurücksetzen')).not.toBeInTheDocument()
    })

    it('confirms first, then resets and shows the fresh password once', async () => {
      const resetMemberPassword = vi.fn().mockResolvedValue({ username: 'stageboard-band-a-p2', password: 'fresh-123' })
      useWorkspaceStore.setState({ resetMemberPassword })
      const confirmMock = vi.fn().mockResolvedValue(true)
      const alertMock = vi.fn().mockResolvedValue(undefined)
      useDialogStore.setState({ confirm: confirmMock, alert: alertMock })

      render(<BandManagementView />)
      openMemberMenu('Chris')
      fireEvent.click(screen.getByText('Passwort zurücksetzen'))

      await waitFor(() => expect(resetMemberPassword).toHaveBeenCalledWith('band-a', 'p2'))
      expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('Chris'), expect.objectContaining({ danger: true }))
      expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('fresh-123'), expect.objectContaining({ title: 'PIN zurückgesetzt' }))
    })

    it('does not reset when the confirmation is declined', async () => {
      const resetMemberPassword = vi.fn()
      useWorkspaceStore.setState({ resetMemberPassword })
      useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(false) })

      render(<BandManagementView />)
      openMemberMenu('Chris')
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
      openMemberMenu('Chris')
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
      openBandMenu('Band A')
      fireEvent.click(screen.getByText('Einladen'))

      await waitFor(() => expect(screen.getByText('11112222')).toBeInTheDocument())
      expect(getAccessCode).toHaveBeenCalledWith('band-a')
    })

    it('"Schließen" closes the invite screen', async () => {
      useWorkspaceStore.setState({
        getAccessCode: vi.fn().mockResolvedValue({ code: '11112222' }),
      })

      render(<BandManagementView />)
      openBandMenu('Band A')
      fireEvent.click(screen.getByText('Einladen'))
      await waitFor(() => expect(screen.getByText('11112222')).toBeInTheDocument())

      fireEvent.click(screen.getByText('Schließen'))
      expect(screen.queryByText('11112222')).not.toBeInTheDocument()
    })
  })

  describe('"Von diesem Gerät entfernen" (2026-09-02 thirteenth follow-up: the non-destructive, non-admin-gated counterpart to "Löschen")', () => {
    it('is offered even to a non-admin member of a server-connected band', () => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', isAdmin: false, username: 'stageboard-band-a-p1', couchPassword: 'pw' }],
      })
      render(<BandManagementView />)

      openBandMenu('Band A')
      expect(screen.getByText('Von diesem Gerät entfernen')).toBeInTheDocument()
      // Admin-only actions stay hidden for this non-admin member.
      expect(screen.queryByText('Einladen')).not.toBeInTheDocument()
      expect(screen.queryByText('Löschen')).not.toBeInTheDocument()
    })

    it('is not offered for a local-only band (no Stage-Server account) - "Löschen" alone covers it there', () => {
      useWorkspaceStore.setState({
        workspaces: [{ id: 'band-a', name: 'Band A', isAdmin: true, ownProfileId: 'p1' }],
      })
      render(<BandManagementView />)

      openBandMenu('Band A')
      expect(screen.queryByText('Von diesem Gerät entfernen')).not.toBeInTheDocument()
      expect(screen.getByText('Löschen')).toBeInTheDocument()
    })

    it('confirms first, then calls removeWorkspaceLocally - not deleteWorkspace', async () => {
      const removeWorkspaceLocally = vi.fn()
      const deleteWorkspace = vi.fn()
      useWorkspaceStore.setState({ removeWorkspaceLocally, deleteWorkspace })
      const confirmMock = vi.fn().mockResolvedValue(true)
      useDialogStore.setState({ confirm: confirmMock })

      render(<BandManagementView />)
      openBandMenu('Band A')
      fireEvent.click(screen.getByText('Von diesem Gerät entfernen'))

      await waitFor(() => expect(removeWorkspaceLocally).toHaveBeenCalledWith('band-a'))
      expect(deleteWorkspace).not.toHaveBeenCalled()
      // Non-danger-styled confirm: unlike "Löschen", this doesn't affect anyone else.
      expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('Band A'), expect.not.objectContaining({ danger: true }))
    })

    it('does not remove it when the confirmation is declined', async () => {
      const removeWorkspaceLocally = vi.fn()
      useWorkspaceStore.setState({ removeWorkspaceLocally })
      useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(false) })

      render(<BandManagementView />)
      openBandMenu('Band A')
      fireEvent.click(screen.getByText('Von diesem Gerät entfernen'))

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(removeWorkspaceLocally).not.toHaveBeenCalled()
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
      // 2026-09-02 tenth follow-up: "Auswählen" is no longer a separate link - a tap on the
      // row itself (here, Chris's name) selects it.
      fireEvent.click(screen.getByText('Chris'))

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

      it('does not make the already-active profile\'s row clickable-to-select (no "Auswählen" link anymore, 2026-09-02 tenth follow-up)', () => {
        render(<BandManagementView />)

        // Marco (p1) is the active profile by default (see the file's top-level beforeEach) -
        // his name sits in a plain (non-clickable) element, unlike Chris's and Jonas's.
        expect(screen.getByText('Marco').closest('button')).toBeNull()
        expect(screen.getByText('Chris').closest('button')).not.toBeNull()
        expect(screen.getByText('Jonas').closest('button')).not.toBeNull()
      })

      it('2026-09-02 second follow-up: picking a non-admin member activates it immediately, with no code prompt at all', async () => {
        const activateProfile = vi.fn().mockResolvedValue({ id: 'band-a', name: 'Band A' })
        const setActive = vi.fn()
        useWorkspaceStore.setState({ activateProfile })
        useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p1' }, setActive })

        render(<BandManagementView />)
        fireEvent.click(screen.getByText('Chris')) // p2, the non-admin one

        await waitFor(() => expect(activateProfile).toHaveBeenCalledWith('band-a', 'p2', undefined))
        await waitFor(() => expect(setActive).toHaveBeenCalledWith('band-a', 'p2'))
        expect(screen.queryByPlaceholderText('4-stelliger Code')).not.toBeInTheDocument()
      })

      it('picking an admin member opens an inline 4-digit code prompt instead of switching immediately', () => {
        render(<BandManagementView />)

        fireEvent.click(screen.getByText('Jonas')) // the admin one

        expect(screen.getByPlaceholderText('4-stelliger Code')).toBeInTheDocument()
      })

      it('submitting the code calls activateProfile, and activates the picked profile locally on success', async () => {
        const activateProfile = vi.fn().mockResolvedValue({ id: 'band-a', name: 'Band A' })
        const setActive = vi.fn()
        useWorkspaceStore.setState({ activateProfile })
        useActiveProfileStore.setState({ byWorkspace: { 'band-a': 'p1' }, setActive })

        render(<BandManagementView />)
        fireEvent.click(screen.getByText('Jonas'))
        fireEvent.change(screen.getByPlaceholderText('4-stelliger Code'), { target: { value: '4711' } })
        fireEvent.click(screen.getByRole('button', { name: 'Wechseln' }))

        await waitFor(() => expect(activateProfile).toHaveBeenCalledWith('band-a', 'p3', '4711'))
        await waitFor(() => expect(setActive).toHaveBeenCalledWith('band-a', 'p3'))
      })

      it('strips non-digit characters, caps the code at 4 digits, and disables submit until then', () => {
        render(<BandManagementView />)
        fireEvent.click(screen.getByText('Jonas'))

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
        fireEvent.click(screen.getByText('Jonas'))
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
        fireEvent.click(screen.getByText('Jonas'))
        fireEvent.change(screen.getByPlaceholderText('4-stelliger Code'), { target: { value: '4711' } })
        fireEvent.click(screen.getByRole('button', { name: 'Wechseln' }))

        await waitFor(() => expect(activateProfile).toHaveBeenCalled())
        expect(setActive).not.toHaveBeenCalled()
        // The prompt stays open for another attempt.
        expect(screen.getByPlaceholderText('4-stelliger Code')).toBeInTheDocument()
      })

      it('2026-09-02 third follow-up: the code prompt does not hint at the universal recovery code at all - that stays known only to Marco', () => {
        render(<BandManagementView />)
        fireEvent.click(screen.getByText('Jonas'))

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

      // Marco (p1) is the active profile - only his row offers a "⋮" menu with "Meinen PIN
      // setzen" at all; Chris's (a different admin, even though also admin) doesn't have the
      // self-PIN option in his own menu.
      openMemberMenu('Marco')
      expect(screen.getByText('Meinen PIN setzen')).toBeInTheDocument()
      fireEvent.click(screen.getByText('Schließen'))

      openMemberMenu('Chris')
      expect(screen.queryByText('Meinen PIN setzen')).not.toBeInTheDocument()
    })

    it('prompts for a new PIN, validates it, and calls setOwnPin', async () => {
      const setOwnPin = vi.fn().mockResolvedValue({ username: 'stageboard-band-a-p1', password: '9876' })
      useWorkspaceStore.setState({ setOwnPin })
      useDialogStore.setState({ promptFields: vi.fn().mockResolvedValue({ pin: '9876' }) })

      render(<BandManagementView />)
      openMemberMenu('Marco')
      fireEvent.click(screen.getByText('Meinen PIN setzen'))

      await waitFor(() => expect(setOwnPin).toHaveBeenCalledWith('band-a', 'p1', '9876'))
    })

    it('rejects a PIN that is not exactly 4 digits, without calling setOwnPin', async () => {
      const setOwnPin = vi.fn()
      useWorkspaceStore.setState({ setOwnPin })
      const alertMock = vi.fn().mockResolvedValue(undefined)
      useDialogStore.setState({ promptFields: vi.fn().mockResolvedValue({ pin: '12345' }), alert: alertMock })

      render(<BandManagementView />)
      openMemberMenu('Marco')
      fireEvent.click(screen.getByText('Meinen PIN setzen'))

      await waitFor(() => expect(alertMock).toHaveBeenCalledWith(expect.stringContaining('4 Ziffern')))
      expect(setOwnPin).not.toHaveBeenCalled()
    })
  })
})
