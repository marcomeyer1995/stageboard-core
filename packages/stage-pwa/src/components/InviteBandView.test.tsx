import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// useWorkspaceStore now imports workspaceDb.ts (removeWorkspaceLocally's
// destroyLocalWorkspaceDb), which constructs a real PouchDB at module load time - unavailable
// under happy-dom (see workspaceDb.test.ts's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
    destroy() {
      return Promise.resolve()
    }
  },
}))

const { useDialogStore } = await import('../store/useDialogStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { InviteBandView } = await import('./InviteBandView')

// fetchLanIp() hits GET /server-info - defaults to "no Stage-Server configured" (no lanIp
// display, plain code-only QR) for every test below except the two that explicitly stub a
// VITE_STAGE_SERVER_URL/fetch response to exercise the embedded-IP behavior. Without this, the
// real `.env`'s VITE_STAGE_SERVER_URL would leak in and every other test would make a live,
// self-signed-cert network call it doesn't care about.
beforeEach(() => {
  vi.stubEnv('VITE_STAGE_SERVER_URL', '')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('InviteBandView', () => {
  it('fetches (never mints) the current access code via getAccessCode and shows it plus a QR image encoding workspaceId:code', async () => {
    const getAccessCode = vi.fn().mockResolvedValue({ code: '12345678' })
    useWorkspaceStore.setState({ getAccessCode })

    render(<InviteBandView workspaceId="band-a" onClose={vi.fn()} />)

    expect(getAccessCode).toHaveBeenCalledWith('band-a')
    await waitFor(() => expect(screen.getByText('12345678')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByAltText('QR-Code für Bandcode 12345678')).toBeInTheDocument())
  })

  it('embeds the Stage-Server\'s current LAN IP in the QR and shows it with a regeneration note', async () => {
    const getAccessCode = vi.fn().mockResolvedValue({ code: '12345678' })
    useWorkspaceStore.setState({ getAccessCode })
    vi.stubEnv('VITE_STAGE_SERVER_URL', 'https://stage.example')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ lanIp: '192.168.1.5' }) }))

    render(<InviteBandView workspaceId="band-a" onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText(/192\.168\.1\.5/)).toBeInTheDocument())
    expect(screen.getByText(/neu erstellt werden/)).toBeInTheDocument()
  })

  it('falls back to a code-only QR (no error shown) when the LAN IP could not be determined', async () => {
    const getAccessCode = vi.fn().mockResolvedValue({ code: '12345678' })
    useWorkspaceStore.setState({ getAccessCode })
    vi.stubEnv('VITE_STAGE_SERVER_URL', '')

    render(<InviteBandView workspaceId="band-a" onClose={vi.fn()} />)

    await waitFor(() => expect(screen.getByText('12345678')).toBeInTheDocument())
    expect(screen.getByText(/Server-Adresse konnte nicht ermittelt werden/)).toBeInTheDocument()
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
