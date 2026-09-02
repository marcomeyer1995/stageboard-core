import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { InviteBandView } from './InviteBandView'

describe('InviteBandView', () => {
  it('fetches (never mints) the current access code via getAccessCode and shows it plus a QR image encoding workspaceId:code', async () => {
    const getAccessCode = vi.fn().mockResolvedValue({ code: '12345678' })
    useWorkspaceStore.setState({ getAccessCode })

    render(<InviteBandView workspaceId="band-a" onClose={vi.fn()} />)

    expect(getAccessCode).toHaveBeenCalledWith('band-a')
    await waitFor(() => expect(screen.getByText('12345678')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByAltText('QR-Code für Bandcode 12345678')).toBeInTheDocument())
  })

  it('shows an error when getAccessCode fails', async () => {
    const getAccessCode = vi.fn().mockResolvedValue(null)
    useWorkspaceStore.setState({ getAccessCode })

    render(<InviteBandView workspaceId="band-a" onClose={vi.fn()} />)

    expect(await screen.findByText('Code konnte nicht geladen werden.')).toBeInTheDocument()
  })

  it('calls onClose when "Schließen" is clicked', async () => {
    const getAccessCode = vi.fn().mockResolvedValue({ code: '12345678' })
    useWorkspaceStore.setState({ getAccessCode })
    const onClose = vi.fn()

    render(<InviteBandView workspaceId="band-a" onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('12345678')).toBeInTheDocument())

    screen.getByText('Schließen').click()
    expect(onClose).toHaveBeenCalled()
  })

  it('"Code ändern" confirms first, then rotates and shows the fresh code', async () => {
    const getAccessCode = vi.fn().mockResolvedValue({ code: '12345678' })
    const rotateAccessCode = vi.fn().mockResolvedValue({ code: '87654321' })
    useWorkspaceStore.setState({ getAccessCode, rotateAccessCode })
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(true) })

    render(<InviteBandView workspaceId="band-a" onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('12345678')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Code ändern'))

    await waitFor(() => expect(rotateAccessCode).toHaveBeenCalledWith('band-a'))
    await waitFor(() => expect(screen.getByText('87654321')).toBeInTheDocument())
    expect(screen.queryByText('12345678')).not.toBeInTheDocument()
  })

  it('does not rotate if the confirmation is declined', async () => {
    const getAccessCode = vi.fn().mockResolvedValue({ code: '12345678' })
    const rotateAccessCode = vi.fn()
    useWorkspaceStore.setState({ getAccessCode, rotateAccessCode })
    useDialogStore.setState({ confirm: vi.fn().mockResolvedValue(false) })

    render(<InviteBandView workspaceId="band-a" onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('12345678')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Code ändern'))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rotateAccessCode).not.toHaveBeenCalled()
    expect(screen.getByText('12345678')).toBeInTheDocument()
  })
})
