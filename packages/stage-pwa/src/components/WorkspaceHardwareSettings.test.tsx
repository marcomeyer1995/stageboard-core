import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

// The wizard has its own test file - mocked here so these tests cover only this section's job:
// showing the current state and starting/closing the wizard.
vi.mock('./SwitchServerBandWizard', () => ({
  SwitchServerBandWizard: ({
    activeWorkspaceId,
    bands,
    onClose,
  }: {
    activeWorkspaceId: string | null
    bands: { workspaceId: string }[]
    onClose: (switched: boolean) => void
  }) => (
    <div data-testid="wizard" data-active={activeWorkspaceId ?? ''} data-bands={bands.length}>
      <button onClick={() => onClose(false)}>wizard-abort</button>
      <button onClick={() => onClose(true)}>wizard-done</button>
    </div>
  ),
}))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { WorkspaceHardwareSettings } = await import('./WorkspaceHardwareSettings')

const workspaceList = [
  { workspaceId: 'band-a', workspaceName: 'Abadschendaler' },
  { workspaceId: 'band-b', workspaceName: 'SOAT' },
]

function stub(overrides: Partial<Parameters<typeof useWorkspaceStore.setState>[0]> = {}) {
  useWorkspaceStore.setState({
    listWorkspaces: vi.fn().mockResolvedValue(workspaceList),
    fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: 'band-a' }),
    fetchServerInfo: vi.fn().mockResolvedValue({ lanIp: '192.168.1.50', hostname: 'stageboard.local' }),
    ...overrides,
  })
}

beforeEach(() => stub())

describe('WorkspaceHardwareSettings', () => {
  it('shows the band currently active on the server and a button to change it', async () => {
    render(<WorkspaceHardwareSettings />)

    await waitFor(() => expect(screen.getByText('Abadschendaler')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Band wechseln…' })).not.toBeDisabled()
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument()
  })

  it('shows the band as soon as its request is answered and marks that the rest is still being fetched', async () => {
    stub({ fetchServerInfo: vi.fn().mockReturnValue(new Promise(() => {})) })
    render(<WorkspaceHardwareSettings />)

    await waitFor(() => expect(screen.getByText('Abadschendaler')).toBeInTheDocument())
    expect(screen.getByText(/aktualisiere…/)).toBeInTheDocument()
  })

  it('offers the on-device Diagnose section', async () => {
    render(<WorkspaceHardwareSettings />)

    expect(screen.getByText('Diagnose')).toBeInTheDocument()
  })

  it('says the server is slow to answer - not unreachable - when nothing has come back after a while', async () => {
    vi.useFakeTimers()
    const never = () => new Promise<never>(() => {})
    stub({
      listWorkspaces: vi.fn().mockImplementation(never),
      fetchActiveWorkspaceHardware: vi.fn().mockImplementation(never),
      fetchServerInfo: vi.fn().mockImplementation(never),
    })
    render(<WorkspaceHardwareSettings />)
    expect(screen.getByText('Lade…')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100)
    })

    expect(screen.getByText('Stage-Server antwortet langsam…')).toBeInTheDocument()
    expect(screen.queryByText('Stage-Server nicht erreichbar.')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows "keine" when nothing has been activated on the server yet', async () => {
    stub({ fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: null }) })
    render(<WorkspaceHardwareSettings />)

    await waitFor(() => expect(screen.getByText('keine')).toBeInTheDocument())
  })

  it('disables the button and says so when the Stage-Server is unreachable', async () => {
    stub({
      listWorkspaces: vi.fn().mockResolvedValue(null),
      fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue(null),
      fetchServerInfo: vi.fn().mockResolvedValue(null),
    })
    render(<WorkspaceHardwareSettings />)

    await waitFor(() => expect(screen.getByText('Stage-Server nicht erreichbar.')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Band wechseln…' })).toBeDisabled()
  })

  it('the button opens the wizard with the server\'s bands and active band; aborting closes it', async () => {
    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('Abadschendaler')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Band wechseln…' }))

    const wizard = screen.getByTestId('wizard')
    expect(wizard).toHaveAttribute('data-active', 'band-a')
    expect(wizard).toHaveAttribute('data-bands', '2')

    fireEvent.click(screen.getByText('wizard-abort'))
    expect(screen.queryByTestId('wizard')).not.toBeInTheDocument()
  })

  it('reloads the server status after a completed switch', async () => {
    const fetchActive = vi.fn().mockResolvedValue({ activeWorkspaceId: 'band-a' })
    stub({ fetchActiveWorkspaceHardware: fetchActive })
    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(fetchActive).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: 'Band wechseln…' }))
    fireEvent.click(screen.getByText('wizard-done'))

    await waitFor(() => expect(fetchActive).toHaveBeenCalledTimes(2))
  })
})
