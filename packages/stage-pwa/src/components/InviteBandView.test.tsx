import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { InviteBandView } from './InviteBandView'

describe('InviteBandView', () => {
  it('mints a workspace-level invite via createInvite and shows the code plus a QR image', async () => {
    const createInvite = vi.fn().mockResolvedValue({ code: '12345678', expiresAt: Date.now() + 60_000 })
    useWorkspaceStore.setState({ createInvite })

    render(<InviteBandView workspaceId="band-a" onClose={vi.fn()} />)

    expect(createInvite).toHaveBeenCalledWith('band-a')
    await waitFor(() => expect(screen.getByText('12345678')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByAltText('QR-Code für Einladungscode 12345678')).toBeInTheDocument())
  })

  it('shows an error when createInvite fails', async () => {
    const createInvite = vi.fn().mockResolvedValue(null)
    useWorkspaceStore.setState({ createInvite })

    render(<InviteBandView workspaceId="band-a" onClose={vi.fn()} />)

    expect(await screen.findByText('Einladung konnte nicht erstellt werden.')).toBeInTheDocument()
  })

  it('calls onClose when "Schließen" is clicked', async () => {
    const createInvite = vi.fn().mockResolvedValue({ code: '12345678', expiresAt: Date.now() + 60_000 })
    useWorkspaceStore.setState({ createInvite })
    const onClose = vi.fn()

    render(<InviteBandView workspaceId="band-a" onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('12345678')).toBeInTheDocument())

    screen.getByText('Schließen').click()
    expect(onClose).toHaveBeenCalled()
  })
})
