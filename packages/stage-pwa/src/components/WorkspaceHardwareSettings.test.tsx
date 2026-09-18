import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// useWorkspaceStore transitively imports workspaceDb.ts, which constructs a real PouchDB at
// module load time - unavailable under happy-dom (see SyncIndicator.test.tsx's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { WorkspaceHardwareSettings } = await import('./WorkspaceHardwareSettings')

const workspaceList = [
  { workspaceId: 'band-a', workspaceName: 'Abadschendaler' },
  { workspaceId: 'band-b', workspaceName: 'SOAT' },
]

beforeEach(() => {
  useWorkspaceStore.setState({
    listWorkspaces: vi.fn().mockResolvedValue(workspaceList),
    fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue({ activeWorkspaceId: 'band-a' }),
    activateWorkspaceHardware: vi.fn().mockResolvedValue(true),
  })
})

describe('WorkspaceHardwareSettings', () => {
  it('lists every band the Stage-Server hosts, marking the currently active one', async () => {
    render(<WorkspaceHardwareSettings />)

    await waitFor(() => expect(screen.getByText('Abadschendaler')).toBeInTheDocument())
    expect(screen.getByText('SOAT')).toBeInTheDocument()
    expect(screen.getByText('Aktiv')).toBeInTheDocument()
  })

  it('does nothing when tapping the already-active band', async () => {
    const activateWorkspaceHardware = vi.fn().mockResolvedValue(true)
    useWorkspaceStore.setState({ activateWorkspaceHardware })

    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('Abadschendaler')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Abadschendaler').closest('button')!)
    expect(activateWorkspaceHardware).not.toHaveBeenCalled()
  })

  it('prompts for fresh admin credentials and activates the selected band', async () => {
    const promptFields = vi.fn().mockResolvedValue({ adminUsername: 'stageboard-band-b-p1', adminPassword: 'fresh-pw' })
    useDialogStore.setState({ promptFields })
    const activateWorkspaceHardware = vi.fn().mockResolvedValue(true)
    useWorkspaceStore.setState({ activateWorkspaceHardware })

    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('SOAT')).toBeInTheDocument())

    fireEvent.click(screen.getByText('SOAT').closest('button')!)

    await waitFor(() =>
      expect(activateWorkspaceHardware).toHaveBeenCalledWith('band-b', 'stageboard-band-b-p1', 'fresh-pw'),
    )
  })

  it('does not activate when the credential prompt is cancelled', async () => {
    useDialogStore.setState({ promptFields: vi.fn().mockResolvedValue(null) })
    const activateWorkspaceHardware = vi.fn().mockResolvedValue(true)
    useWorkspaceStore.setState({ activateWorkspaceHardware })

    render(<WorkspaceHardwareSettings />)
    await waitFor(() => expect(screen.getByText('SOAT')).toBeInTheDocument())

    fireEvent.click(screen.getByText('SOAT').closest('button')!)

    await Promise.resolve()
    expect(activateWorkspaceHardware).not.toHaveBeenCalled()
  })
})
