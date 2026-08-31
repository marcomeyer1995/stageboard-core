import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { JoinBandView } from './JoinBandView'

beforeEach(() => {
  // Matches the real defaults (see useWorkspaceStore.ts) - a brand-new device knows nothing
  // yet, which is exactly the scenario this screen exists for.
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: '' })
})

describe('JoinBandView', () => {
  it('submits the typed 8-digit code via joinWithInviteCode', async () => {
    const joinWithInviteCode = vi.fn().mockResolvedValue({ id: 'band-a', name: 'Band A' })
    useWorkspaceStore.setState({ joinWithInviteCode })

    render(<JoinBandView />)

    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '12345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }))

    await waitFor(() => expect(joinWithInviteCode).toHaveBeenCalledWith('12345678'))
  })

  it('strips non-digit characters and caps the code at 8 characters', () => {
    render(<JoinBandView />)
    const input = screen.getByPlaceholderText('12345678') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12-34ab56 78 99' } })
    expect(input.value).toBe('12345678')
  })

  it('shows an error when the code is invalid or expired', async () => {
    const joinWithInviteCode = vi.fn().mockResolvedValue(null)
    useWorkspaceStore.setState({ joinWithInviteCode })

    render(<JoinBandView />)
    fireEvent.change(screen.getByPlaceholderText('12345678'), { target: { value: '99999999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }))

    expect(await screen.findByText('Code ungültig oder abgelaufen.')).toBeInTheDocument()
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
