import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Dashboard } from 'shared-types'

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
const { useDashboardsStore } = await import('../store/useDashboardsStore')
const { useActiveDashboardStore } = await import('../store/useActiveDashboardStore')
const { AppMenu } = await import('./AppMenu')

function dashboard(id: string, name: string, order: number): Dashboard {
  return { id, name, order, widgets: [], layouts: {}, visibility: 'public' }
}

beforeEach(() => {
  useDashboardsStore.setState({ dashboards: [] })
  useActiveDashboardStore.setState({ byWorkspace: {} })
})

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

describe('AppMenu dashboard picker (#35)', () => {
  it('hides the picker entirely with fewer than two switchable dashboards - nothing to switch to', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    useDashboardsStore.setState({ dashboards: [dashboard('d1', 'Bühne', 0)] })
    render(<AppMenu mode="library" onSelectMode={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByText('Dashboards')).not.toBeInTheDocument()
  })

  it('lists every dashboard, highlights the active one, and lets any mode reach it (not gated on already being in live mode)', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    useDashboardsStore.setState({ dashboards: [dashboard('d1', 'Bühne', 0), dashboard('d2', 'Monitor', 1)] })
    useActiveDashboardStore.setState({ byWorkspace: { 'band-a': 'd2' } })

    render(<AppMenu mode="system" onSelectMode={vi.fn()} onClose={vi.fn()} />)

    const active = screen.getByRole('button', { name: /Monitor/ })
    const inactive = screen.getByRole('button', { name: 'Bühne' })
    expect(active).toHaveClass('bg-accent')
    expect(inactive).not.toHaveClass('bg-accent')
  })

  it('picking a dashboard sets it active, switches to Live mode, and closes the menu - one tap from anywhere', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    useDashboardsStore.setState({ dashboards: [dashboard('d1', 'Bühne', 0), dashboard('d2', 'Monitor', 1)] })
    const onSelectMode = vi.fn()
    const onClose = vi.fn()

    render(<AppMenu mode="library" onSelectMode={onSelectMode} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Monitor' }))

    expect(useActiveDashboardStore.getState().byWorkspace['band-a']).toBe('d2')
    expect(onSelectMode).toHaveBeenCalledWith('live')
    expect(onClose).toHaveBeenCalled()
  })
})
