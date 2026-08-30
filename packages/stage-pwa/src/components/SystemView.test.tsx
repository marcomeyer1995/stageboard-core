import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// PluginManager/BackupManager/PostShowReport transitively import workspaceDb.ts, which
// constructs a real PouchDB at module load time - unavailable under happy-dom (see
// workspaceDb.test.ts's identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { usePluginsStore } = await import('../store/usePluginsStore')
const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { SystemView } = await import('./SystemView')

beforeEach(() => {
  useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: '' })
})

describe('SystemView', () => {
  it('defaults to the Band tab and switches to Plugins/Nachbericht on click', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    expect(screen.getByText('Bands verwalten', { selector: 'h1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }))
    expect(screen.getByText('Plugins', { selector: 'h1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Nachbericht' }))
    expect(screen.getByText('Nachbericht', { selector: 'h1' })).toBeInTheDocument()
  })

  it('hides the Backup tab when no plugin provides the backup capability', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)
    expect(screen.queryByRole('button', { name: 'Backup' })).not.toBeInTheDocument()
  })

  it('shows the Backup tab once a backup-capable plugin is installed', () => {
    usePluginsStore.setState({
      installed: [
        {
          id: 'mock-backup',
          name: 'Mock Backup',
          version: '0.0.1',
          runtime: 'server',
          capabilities: ['backup'],
          enabled: true,
          installedAt: Date.now(),
        },
      ],
    })
    render(<SystemView />)
    expect(screen.getByRole('button', { name: 'Backup' })).toBeInTheDocument()
  })

  it('switching to Einstellungen renders the moved-out settings sections', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen' }))

    expect(screen.getByText('Darstellung')).toBeInTheDocument()
    expect(screen.getByText('Speicher & Sync')).toBeInTheDocument()
    // Vollbild stays in AppMenu.tsx (Marco asked for it to remain directly reachable there),
    // not duplicated here.
    expect(screen.queryByText('Anzeige')).not.toBeInTheDocument()
  })
})
