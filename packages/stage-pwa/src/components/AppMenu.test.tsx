import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// ProfileSwitcher/WorkspaceSwitcher transitively import workspaceDb.ts, which constructs a
// real PouchDB at module load time - unavailable under happy-dom (see workspaceDb.test.ts's
// identical mock).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { AppMenu } = await import('./AppMenu')

describe('AppMenu', () => {
  it('offers exactly the three top-level modes (Live/Bibliothek/System)', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    render(<AppMenu mode="live" onSelectMode={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Live' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bibliothek' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Plugins' })).not.toBeInTheDocument()
  })

  it('no longer shows the settings sections moved to SystemView (Darstellung, Sync, Speicher & Sync)', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    render(<AppMenu mode="live" onSelectMode={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByText('Darstellung')).not.toBeInTheDocument()
    expect(screen.queryByText('Synchronisation')).not.toBeInTheDocument()
    expect(screen.queryByText('Speicher & Sync')).not.toBeInTheDocument()
  })

  it('keeps Vollbild (fullscreen) directly in the main menu, not moved to SystemView', () => {
    // happy-dom doesn't implement the Fullscreen API at all (document.fullscreenEnabled is
    // undefined) - stub it so useFullscreen.ts's `supported` check actually resolves true,
    // otherwise this assertion would silently never run.
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      value: vi.fn(),
      configurable: true,
    })

    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    render(<AppMenu mode="live" onSelectMode={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('Anzeige')).toBeInTheDocument()
    expect(screen.getByText('Vollbild')).toBeInTheDocument()
  })

  it('2026-09-02: no longer shows "Wer bin ich" - band/profile switching moved to BandManagementView.tsx\'s "Band" tab', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    render(<AppMenu mode="live" onSelectMode={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByText('Wer bin ich')).not.toBeInTheDocument()
  })

  it('only shows the Dashboard edit-lock section in live mode', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    const { rerender } = render(<AppMenu mode="live" onSelectMode={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()

    rerender(<AppMenu mode="library" onSelectMode={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
  })
})
