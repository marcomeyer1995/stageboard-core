import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { JoinBandView } from './JoinBandView'

const roster = {
  workspaceId: 'band-c',
  workspaceName: 'Band C',
  members: [
    { profileId: 'p1', name: 'Marco', role: 'Gitarre', requiresPassword: false },
    { profileId: 'p2', name: 'Chris', role: 'Bass', requiresPassword: true },
  ],
}

beforeEach(() => {
  // Matches the real defaults (see useWorkspaceStore.ts) - a brand-new device knows nothing
  // yet, which is exactly the scenario this screen exists for.
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: '' })
})

describe('JoinBandView - code entry step', () => {
  it('submits the typed 8-digit code via fetchRoster and shows the roster picker on success', async () => {
    const fetchRoster = vi.fn().mockResolvedValue(roster)
    useWorkspaceStore.setState({ fetchRoster })

    render(<JoinBandView />)

    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    await waitFor(() => expect(fetchRoster).toHaveBeenCalledWith('12345678'))
    expect(await screen.findByText('Wer bist du?')).toBeInTheDocument()
    expect(screen.getByText(/Band C/)).toBeInTheDocument()
    expect(screen.getByText('Marco', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Chris', { exact: false })).toBeInTheDocument()
  })

  it('strips non-digit characters and caps the code at 8 characters', () => {
    render(<JoinBandView />)
    const input = screen.getByPlaceholderText('12345678') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12-34ab56 78 99' } })
    expect(input.value).toBe('12345678')
  })

  it('stays on the code-entry step when fetchRoster fails (already alerted by the store)', async () => {
    const fetchRoster = vi.fn().mockResolvedValue(null)
    useWorkspaceStore.setState({ fetchRoster })

    render(<JoinBandView />)
    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '99999999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))

    await waitFor(() => expect(fetchRoster).toHaveBeenCalled())
    expect(screen.queryByText('Wer bist du?')).not.toBeInTheDocument()
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

  it('"Neue Band gründen" prompts for a name (in-app dialog) and calls addWorkspace', async () => {
    const addWorkspace = vi.fn().mockResolvedValue({ id: 'new-id', name: 'New Band' })
    useWorkspaceStore.setState({ addWorkspace })
    useDialogStore.setState({ promptText: vi.fn().mockResolvedValue('New Band') })

    render(<JoinBandView />)
    fireEvent.click(screen.getByText('Neue Band gründen'))

    await waitFor(() => expect(addWorkspace).toHaveBeenCalledWith('New Band'))
  })

  it('falls back to manual entry outside a secure context (happy-dom is not https)', async () => {
    render(<JoinBandView />)
    fireEvent.click(screen.getByText('Kamera zum Scannen starten'))
    expect(await screen.findByText('Kamera braucht HTTPS - Code manuell eingeben.')).toBeInTheDocument()
  })

  it('falls back to manual entry when the camera API itself is unsupported', async () => {
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

describe('JoinBandView - "wer bist du?" roster picker', () => {
  async function renderAtPicker() {
    const fetchRoster = vi.fn().mockResolvedValue(roster)
    const joinAsMember = vi.fn().mockResolvedValue({ id: 'band-c', name: 'Band C' })
    useWorkspaceStore.setState({ fetchRoster, joinAsMember })

    render(<JoinBandView />)
    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    await screen.findByText('Wer bist du?')

    return { joinAsMember }
  }

  it('joins immediately (no password prompt) when the picked member has no account yet', async () => {
    const { joinAsMember } = await renderAtPicker()

    fireEvent.click(screen.getByText('Marco', { exact: false }))

    await waitFor(() => expect(joinAsMember).toHaveBeenCalledWith('12345678', 'band-c', 'Band C', 'p1', undefined))
  })

  it('shows an inline password prompt for a member whose account already exists, and joins once submitted', async () => {
    const { joinAsMember } = await renderAtPicker()

    fireEvent.click(screen.getByText('Chris', { exact: false }))
    expect(screen.getByPlaceholderText('PIN/Passwort')).toBeInTheDocument()
    expect(joinAsMember).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('PIN/Passwort'), { target: { value: 'their-pin' } })
    fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }))

    await waitFor(() => expect(joinAsMember).toHaveBeenCalledWith('12345678', 'band-c', 'Band C', 'p2', 'their-pin'))
  })

  it('"Abbrechen" on the password prompt returns to the plain member list without joining', async () => {
    const { joinAsMember } = await renderAtPicker()

    fireEvent.click(screen.getByText('Chris', { exact: false }))
    fireEvent.click(screen.getByText('Abbrechen'))

    expect(screen.queryByPlaceholderText('PIN/Passwort')).not.toBeInTheDocument()
    expect(joinAsMember).not.toHaveBeenCalled()
  })

  it('"Anderen Code verwenden" goes back to the code-entry step', async () => {
    await renderAtPicker()

    fireEvent.click(screen.getByText('Anderen Code verwenden'))

    expect(screen.queryByText('Wer bist du?')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('12345678')).toBeInTheDocument()
  })
})
