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

// The final phase reuses InviteBandView.tsx, whose fetchLanIp() would otherwise pick up the
// real .env's VITE_STAGE_SERVER_URL and make a live, self-signed-cert network call no test here
// cares about - see InviteBandView.test.tsx's identical stub.
beforeEach(() => {
  vi.stubEnv('VITE_STAGE_SERVER_URL', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const { useActiveProfileStore } = await import('../store/useActiveProfileStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { useProfilesStore } = await import('../store/useProfilesStore')
const { useRosterSetupStore } = await import('../store/useRosterSetupStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { RosterSetupView } = await import('./RosterSetupView')

function seedStores(options: { connected?: boolean; profiles?: Array<{ id: string; name: string }> } = {}) {
  const connected = options.connected ?? true
  useWorkspaceStore.setState({
    workspaces: [
      {
        id: 'band-a',
        name: 'Band A',
        ownProfileId: 'founder-id',
        isAdmin: true,
        ...(connected ? { username: 'stageboard-band-a-founder-id', couchPassword: 'random-founding-pw' } : {}),
      },
    ],
    activeWorkspaceId: 'band-a',
    deleteWorkspace: vi.fn(),
    setOwnPin: vi.fn().mockResolvedValue({ username: 'stageboard-band-a-founder-id', password: '4711' }),
  })
  useProfilesStore.setState({
    profiles: (options.profiles ?? []).map((p) => ({ ...p, stageRoles: p.id === 'founder-id' ? (['admin'] as const) : [] })),
    loaded: true,
    create: vi.fn(),
    remove: vi.fn(),
  })
  useRosterSetupStore.setState({ completedFor: {} })
  useActiveProfileStore.setState({ byWorkspace: {} })
}

describe('RosterSetupView', () => {
  describe('phase 1: founder (name + mandatory 4-digit PIN)', () => {
    it('"Weiter" is disabled until both a name and a full 4-digit PIN are entered', () => {
      seedStores()
      render(<RosterSetupView />)

      const weiter = screen.getByRole('button', { name: 'Weiter' })
      expect(weiter).toBeDisabled()

      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      expect(weiter).toBeDisabled()

      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '47' } })
      expect(weiter).toBeDisabled()

      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      expect(weiter).not.toBeDisabled()
    })

    it('strips non-digit characters and caps the PIN at 4 digits', () => {
      seedStores()
      render(<RosterSetupView />)

      const pin = screen.getByPlaceholderText('4-stelliger PIN') as HTMLInputElement
      fireEvent.change(pin, { target: { value: '47-11 22' } })
      expect(pin.value).toBe('4711')
    })

    it('submitting creates the founder profile, sets the PIN via setOwnPin, then advances to phase 2', async () => {
      const create = vi.fn()
      const setOwnPin = vi.fn().mockResolvedValue({ username: 'stageboard-band-a-founder-id', password: '4711' })
      seedStores()
      useProfilesStore.setState({ create })
      useWorkspaceStore.setState({ setOwnPin })

      render(<RosterSetupView />)
      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

      await waitFor(() => expect(create).toHaveBeenCalledWith('Marco'))
      expect(setOwnPin).toHaveBeenCalledWith('band-a', 'founder-id', '4711')
      expect(await screen.findByText(/Wer ist alles bei Band A dabei\?/)).toBeInTheDocument()
    })

    it('immediately sets the founder as this device\'s own active profile - typing your own name here already answers "wer bist du?", so ProfileRolePickerView.tsx should never have to ask again', async () => {
      seedStores()

      render(<RosterSetupView />)
      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

      await screen.findByText(/Wer ist alles bei Band A dabei\?/)
      expect(useActiveProfileStore.getState().byWorkspace['band-a']).toBe('founder-id')
    })

    it('local-only founding (no Stage-Server) still collects the PIN, but never calls setOwnPin - there is no account to set it on yet', async () => {
      const setOwnPin = vi.fn()
      seedStores({ connected: false })
      useWorkspaceStore.setState({ setOwnPin })

      render(<RosterSetupView />)
      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

      await screen.findByText(/Wer ist alles bei Band A dabei\?/)
      expect(setOwnPin).not.toHaveBeenCalled()
    })

    it('advances to phase 2 even when setOwnPin fails - a network hiccup should not strand the founder mid-setup', async () => {
      seedStores()
      useWorkspaceStore.setState({ setOwnPin: vi.fn().mockResolvedValue(null) })

      render(<RosterSetupView />)
      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

      expect(await screen.findByText(/Wer ist alles bei Band A dabei\?/)).toBeInTheDocument()
    })

    it('"Bandnamen falsch eingegeben? Neu anfangen" confirms, then deletes the workspace', async () => {
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

  describe('phase 2: members (name only)', () => {
    async function renderAtMembers() {
      seedStores({ profiles: [{ id: 'founder-id', name: 'Marco' }] })
      const create = vi.fn()
      useProfilesStore.setState({ create })

      render(<RosterSetupView />)
      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
      await screen.findByText(/Wer ist alles bei Band A dabei\?/)

      return { create }
    }

    it('lists already-added members, including the founder marked "(du)"', async () => {
      await renderAtMembers()

      expect(screen.getByText('Marco')).toBeInTheDocument()
      expect(screen.getByText('(du)')).toBeInTheDocument()
    })

    it('the add-member form only has a Name field - no role, no PIN', async () => {
      await renderAtMembers()

      expect(screen.getByPlaceholderText('Name')).toBeInTheDocument()
      expect(screen.queryByPlaceholderText(/Instrument/)).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText(/PIN/)).not.toBeInTheDocument()
    })

    it('adding a member calls create() with just the name and clears the field', async () => {
      const { create } = await renderAtMembers()

      fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Chris' } })
      fireEvent.click(screen.getByText('Hinzufügen'))

      await waitFor(() => expect(create).toHaveBeenCalledWith('Chris'))
      await waitFor(() => expect((screen.getByPlaceholderText('Name') as HTMLInputElement).value).toBe(''))
    })

    it('"Entfernen" is offered for other members but not for the founder\'s own row', async () => {
      seedStores({
        profiles: [
          { id: 'founder-id', name: 'Marco' },
          { id: 'p2', name: 'Chris' },
        ],
      })
      render(<RosterSetupView />)
      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
      await screen.findByText(/Wer ist alles bei Band A dabei\?/)

      expect(screen.getAllByText('Entfernen')).toHaveLength(1)
    })

    it('"Entfernen" calls remove() for that profile', async () => {
      const remove = vi.fn()
      seedStores({
        profiles: [
          { id: 'founder-id', name: 'Marco' },
          { id: 'p2', name: 'Chris' },
        ],
      })
      useProfilesStore.setState({ remove })
      render(<RosterSetupView />)
      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
      await screen.findByText(/Wer ist alles bei Band A dabei\?/)

      fireEvent.click(screen.getByText('Entfernen'))
      expect(remove).toHaveBeenCalledWith('p2')
    })

    it('does not offer "Neu anfangen" anymore - the founder\'s own profile already exists', async () => {
      await renderAtMembers()
      expect(screen.queryByText('Bandnamen falsch eingegeben? Neu anfangen')).not.toBeInTheDocument()
    })

    it('"Weiter" advances to the summary screen when connected to a Stage-Server', async () => {
      useWorkspaceStore.setState({ getAccessCode: vi.fn().mockResolvedValue({ code: '12345678' }) })
      await renderAtMembers()

      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

      expect(await screen.findByText('Code speichern!')).toBeInTheDocument()
    })

    it('"Weiter" marks roster setup complete directly when local-only - nothing to show yet', async () => {
      seedStores({ connected: false, profiles: [{ id: 'founder-id', name: 'Marco' }] })
      render(<RosterSetupView />)
      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
      await screen.findByText(/Wer ist alles bei Band A dabei\?/)

      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

      expect(useRosterSetupStore.getState().completedFor['band-a']).toBe(true)
      expect(screen.queryByText('Code speichern!')).not.toBeInTheDocument()
    })
  })

  describe('phase 3: summary (reuses InviteBandView.tsx)', () => {
    it('marks roster setup complete when the summary screen is dismissed, not any earlier', async () => {
      seedStores({ profiles: [{ id: 'founder-id', name: 'Marco' }] })
      useWorkspaceStore.setState({ getAccessCode: vi.fn().mockResolvedValue({ code: '12345678' }) })

      render(<RosterSetupView />)
      fireEvent.change(screen.getByPlaceholderText('Dein Name'), { target: { value: 'Marco' } })
      fireEvent.change(screen.getByPlaceholderText('4-stelliger PIN'), { target: { value: '4711' } })
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
      await screen.findByText(/Wer ist alles bei Band A dabei\?/)
      fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
      await screen.findByText('Code speichern!')

      expect(useRosterSetupStore.getState().completedFor['band-a']).toBeFalsy()

      fireEvent.click(screen.getByText('Fertig'))

      expect(useRosterSetupStore.getState().completedFor['band-a']).toBe(true)
    })
  })
})
