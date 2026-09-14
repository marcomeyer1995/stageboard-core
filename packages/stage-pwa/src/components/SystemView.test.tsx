import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

/** Mutable matchMedia stand-in for useInputCapability.ts - both queries it makes
 * ((pointer: fine)/(hover: hover)) are driven by one flag here, since these tests only need a
 * clean pointer/touch toggle, not to distinguish the two queries from each other. A downgrade
 * (pointer -> touch) commits immediately with no mousemove corroboration needed, per
 * useInputCapability.ts's own doc comment, so `.set(false)` alone is enough to flip the lane
 * live. */
function stubMatchMedia(isPointer: boolean) {
  const state = { isPointer }
  const listeners: Array<() => void> = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return state.isPointer
      },
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: (_: string, cb: () => void) => {
        const i = listeners.indexOf(cb)
        if (i !== -1) listeners.splice(i, 1)
      },
    })),
  )
  return {
    set(next: boolean) {
      state.isPointer = next
      listeners.forEach((cb) => cb())
    },
  }
}

describe('SystemView', () => {
  it('defaults to the Band tab and switches to Plugins/Nachbericht on click', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    expect(screen.getByText('Bands verwalten', { selector: 'h1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }))
    expect(screen.getByText('Plugins', { selector: 'h1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Nachbericht' }))
    expect(screen.getByText('Nachbericht', { selector: 'h1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Geräte' }))
    expect(screen.getByText('Geräte', { selector: 'h1' })).toBeInTheDocument()
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
          transports: [],
          hardwareIds: [],
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

describe('SystemView - sidebar (pointer lane) vs. tab strip (touch lane), #179', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pointer lane (happy-dom default): a vertical sidebar, not the horizontal strip', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    const bandButton = screen.getByRole('button', { name: 'Band' })
    expect(bandButton.parentElement).toHaveClass('w-56')
    expect(bandButton.parentElement).not.toHaveClass('overflow-x-auto')
  })

  it('touch lane: the existing horizontal strip, not the sidebar', () => {
    stubMatchMedia(false)
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    const bandButton = screen.getByRole('button', { name: 'Band' })
    expect(bandButton.parentElement).toHaveClass('overflow-x-auto')
    expect(bandButton.parentElement).not.toHaveClass('w-56')
  })

  it('switching lanes mid-session (e.g. unplugging a mouse) keeps the active tab', () => {
    const media = stubMatchMedia(true)
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    fireEvent.click(screen.getByRole('button', { name: 'Plugins' }))
    expect(screen.getByText('Plugins', { selector: 'h1' })).toBeInTheDocument()

    act(() => media.set(false))

    expect(screen.getByText('Plugins', { selector: 'h1' })).toBeInTheDocument()
  })
})
