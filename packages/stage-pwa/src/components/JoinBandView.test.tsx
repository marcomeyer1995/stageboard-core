import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { JoinBandView } from './JoinBandView'

const workspaceList = [
  { workspaceId: 'band-c', workspaceName: 'Band C' },
  { workspaceId: 'band-d', workspaceName: 'Band D' },
]

const roster = {
  workspaceId: 'band-c',
  workspaceName: 'Band C',
  members: [
    { profileId: 'p1', name: 'Marco', isAdmin: false },
    { profileId: 'p2', name: 'Chris', isAdmin: false },
    { profileId: 'p3', name: 'Jonas', isAdmin: true },
  ],
}

beforeEach(() => {
  // Matches the real defaults (see useWorkspaceStore.ts) - a brand-new device knows nothing
  // yet, which is exactly the scenario this screen exists for.
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: '',
    // Step 1 always fires listWorkspaces() on mount - every test needs some stub for it, even
    // ones only concerned with a later step.
    listWorkspaces: vi.fn().mockResolvedValue([]),
  })
})

describe('JoinBandView - step 1: workspace list (landing, no code needed)', () => {
  it('lists every band the Stage-Server hosts on mount, with no code entry', async () => {
    useWorkspaceStore.setState({ listWorkspaces: vi.fn().mockResolvedValue(workspaceList) })

    render(<JoinBandView />)

    expect(await screen.findByText('Band C')).toBeInTheDocument()
    expect(screen.getByText('Band D')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('12345678')).not.toBeInTheDocument()
  })

  it('shows an empty-state message when the server hosts no bands', async () => {
    render(<JoinBandView />)

    expect(await screen.findByText('Keine Band auf diesem Stage-Server gefunden.')).toBeInTheDocument()
  })

  it('"Neu laden" re-fetches the workspace list', async () => {
    const listWorkspaces = vi.fn().mockResolvedValue(workspaceList)
    useWorkspaceStore.setState({ listWorkspaces })

    render(<JoinBandView />)
    await screen.findByText('Band C')
    expect(listWorkspaces).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Neu laden'))

    await waitFor(() => expect(listWorkspaces).toHaveBeenCalledTimes(2))
  })

  it('picking a band advances to the code-entry step without calling fetchRoster yet', async () => {
    const fetchRoster = vi.fn()
    useWorkspaceStore.setState({ listWorkspaces: vi.fn().mockResolvedValue(workspaceList), fetchRoster })

    render(<JoinBandView />)
    fireEvent.click(await screen.findByText('Band C'))

    expect(await screen.findByPlaceholderText('12345678')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Band C' })).toBeInTheDocument()
    expect(fetchRoster).not.toHaveBeenCalled()
  })

  it('"Neue Band gründen" prompts for a name (in-app dialog) and calls addWorkspace', async () => {
    const addWorkspace = vi.fn().mockResolvedValue({ id: 'new-id', name: 'New Band' })
    useWorkspaceStore.setState({ addWorkspace })
    useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('New Band') })

    render(<JoinBandView />)
    fireEvent.click(screen.getByText('Neue Band gründen'))

    await waitFor(() => expect(addWorkspace).toHaveBeenCalledWith('New Band'))
  })

  it('the "Passwort direkt eingeben" fallback calls joinWithPassword with the typed id, username and password', () => {
    const joinWithPassword = vi.fn()
    useWorkspaceStore.setState({ joinWithPassword })

    render(<JoinBandView />)
    fireEvent.click(screen.getByText('Passwort direkt eingeben'))
    fireEvent.change(screen.getByPlaceholderText('Workspace-ID (z.B. band-a)'), { target: { value: 'band-a' } })
    fireEvent.change(screen.getByPlaceholderText('Benutzername (z.B. stageboard-band-a-p1)'), {
      target: { value: 'stageboard-band-a-p1' },
    })
    fireEvent.change(screen.getByPlaceholderText('Passwort/PIN'), { target: { value: 'raw-pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(joinWithPassword).toHaveBeenCalledWith('band-a', 'stageboard-band-a-p1', 'raw-pw', false)
  })

  it('the "Passwort direkt eingeben" fallback passes isAdmin true when the checkbox is checked', () => {
    const joinWithPassword = vi.fn()
    useWorkspaceStore.setState({ joinWithPassword })

    render(<JoinBandView />)
    fireEvent.click(screen.getByText('Passwort direkt eingeben'))
    fireEvent.change(screen.getByPlaceholderText('Workspace-ID (z.B. band-a)'), { target: { value: 'band-a' } })
    fireEvent.change(screen.getByPlaceholderText('Benutzername (z.B. stageboard-band-a-p1)'), {
      target: { value: 'stageboard-band-a-p1' },
    })
    fireEvent.change(screen.getByPlaceholderText('Passwort/PIN'), { target: { value: 'raw-pw' } })
    fireEvent.click(screen.getByText('Dies ist ein Admin-Konto'))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))

    expect(joinWithPassword).toHaveBeenCalledWith('band-a', 'stageboard-band-a-p1', 'raw-pw', true)
  })

  it('falls back to manual selection outside a secure context (happy-dom is not https)', async () => {
    render(<JoinBandView />)
    fireEvent.click(screen.getByText('Kamera zum Scannen starten'))
    expect(await screen.findByText('Kamera braucht HTTPS - Band unten auswählen.')).toBeInTheDocument()
  })

  it('falls back to manual selection when the camera API itself is unsupported', async () => {
    vi.stubGlobal('isSecureContext', true)
    const originalMediaDevices = navigator.mediaDevices
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })

    render(<JoinBandView />)
    fireEvent.click(screen.getByText('Kamera zum Scannen starten'))

    expect(await screen.findByText('Kamera nicht verfügbar auf diesem Gerät.')).toBeInTheDocument()

    Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true })
    vi.unstubAllGlobals()
  })
})

describe('JoinBandView - step 2: code entry (scoped to the picked band)', () => {
  async function renderAtCodeEntry() {
    useWorkspaceStore.setState({ listWorkspaces: vi.fn().mockResolvedValue(workspaceList) })
    render(<JoinBandView />)
    fireEvent.click(await screen.findByText('Band C'))
    await screen.findByPlaceholderText('12345678')
  }

  it('submits the typed 8-digit code via fetchRoster, scoped to the picked workspace, and shows the roster picker on success', async () => {
    const fetchRoster = vi.fn().mockResolvedValue(roster)
    useWorkspaceStore.setState({ fetchRoster })
    await renderAtCodeEntry()

    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    await waitFor(() => expect(fetchRoster).toHaveBeenCalledWith('band-c', '12345678'))
    expect(await screen.findByText('Wer bist du?')).toBeInTheDocument()
    expect(screen.getByText(/Band C/)).toBeInTheDocument()
    expect(screen.getByText('Marco', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Chris', { exact: false })).toBeInTheDocument()
  })

  it('strips non-digit characters and caps the code at 8 characters', async () => {
    await renderAtCodeEntry()
    const input = screen.getByPlaceholderText('12345678') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12-34ab56 78 99' } })
    expect(input.value).toBe('12345678')
  })

  it('stays on the code-entry step when fetchRoster fails (already alerted by the store)', async () => {
    const fetchRoster = vi.fn().mockResolvedValue(null)
    useWorkspaceStore.setState({ fetchRoster })
    await renderAtCodeEntry()

    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '99999999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    await waitFor(() => expect(fetchRoster).toHaveBeenCalled())
    expect(screen.queryByText('Wer bist du?')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument()
  })

  it('"Andere Band wählen" returns to the step 1 workspace list', async () => {
    await renderAtCodeEntry()

    fireEvent.click(screen.getByText('Andere Band wählen'))

    expect(await screen.findByText('Band C')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('12345678')).not.toBeInTheDocument()
  })
})

describe('JoinBandView - step 3: "wer bist du?" roster picker', () => {
  async function renderAtPicker() {
    const fetchRoster = vi.fn().mockResolvedValue(roster)
    const joinAsMember = vi.fn().mockResolvedValue({ id: 'band-c', name: 'Band C' })
    useWorkspaceStore.setState({ listWorkspaces: vi.fn().mockResolvedValue(workspaceList), fetchRoster, joinAsMember })

    render(<JoinBandView />)
    fireEvent.click(await screen.findByText('Band C'))
    fireEvent.change(await screen.findByPlaceholderText('12345678'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    await screen.findByText('Wer bist du?')

    return { joinAsMember }
  }

  it('joins immediately (no code prompt at all) when the picked member is not an admin', async () => {
    const { joinAsMember } = await renderAtPicker()

    fireEvent.click(screen.getByText('Marco', { exact: false }))

    await waitFor(() => expect(joinAsMember).toHaveBeenCalledWith('band-c', 'Band C', '12345678', 'p1', undefined))
  })

  it('a second non-admin member also joins immediately, no code prompt (2026-09-02 second follow-up: non-admins never have a password concept)', async () => {
    const { joinAsMember } = await renderAtPicker()

    fireEvent.click(screen.getByText('Chris', { exact: false }))

    await waitFor(() => expect(joinAsMember).toHaveBeenCalledWith('band-c', 'Band C', '12345678', 'p2', undefined))
    expect(screen.queryByPlaceholderText('4-stelliger Code')).not.toBeInTheDocument()
  })

  it('shows an inline 4-digit code prompt for an admin member, and joins once submitted', async () => {
    const { joinAsMember } = await renderAtPicker()

    fireEvent.click(screen.getByText('Jonas', { exact: false }))
    expect(screen.getByPlaceholderText('4-stelliger Code')).toBeInTheDocument()
    expect(joinAsMember).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('4-stelliger Code'), { target: { value: '4711' } })
    fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }))

    await waitFor(() => expect(joinAsMember).toHaveBeenCalledWith('band-c', 'Band C', '12345678', 'p3', '4711'))
  })

  it('strips non-digit characters and caps the admin code at 4 digits, disabling submit until then', async () => {
    await renderAtPicker()
    fireEvent.click(screen.getByText('Jonas', { exact: false }))

    const input = screen.getByPlaceholderText('4-stelliger Code') as HTMLInputElement
    fireEvent.change(input, { target: { value: '47-11 22' } })
    expect(input.value).toBe('4711')
    expect(screen.getByRole('button', { name: 'Beitreten' })).not.toBeDisabled()

    fireEvent.change(input, { target: { value: '47' } })
    expect(screen.getByRole('button', { name: 'Beitreten' })).toBeDisabled()
  })

  it('"Abbrechen" on the code prompt returns to the plain member list without joining', async () => {
    const { joinAsMember } = await renderAtPicker()

    fireEvent.click(screen.getByText('Jonas', { exact: false }))
    fireEvent.click(screen.getByText('Abbrechen'))

    expect(screen.queryByPlaceholderText('4-stelliger Code')).not.toBeInTheDocument()
    expect(joinAsMember).not.toHaveBeenCalled()
  })

  it('2026-09-02 third follow-up: the admin code prompt does not hint at the universal recovery code at all - that stays known only to Marco', async () => {
    await renderAtPicker()

    fireEvent.click(screen.getByText('Jonas', { exact: false }))

    expect(screen.queryByText(/letzten 4 Ziffern/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Band-Codes/)).not.toBeInTheDocument()
  })

  it('"Andere Band oder anderer Code" resets all the way back to the step 1 workspace list', async () => {
    await renderAtPicker()

    fireEvent.click(screen.getByText('Andere Band oder anderer Code'))

    expect(screen.queryByText('Wer bist du?')).not.toBeInTheDocument()
    expect(await screen.findByText('Band C')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('12345678')).not.toBeInTheDocument()
  })
})
