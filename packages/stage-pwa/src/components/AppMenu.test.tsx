import { fireEvent, render, screen, within } from '@testing-library/react'
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

const native = vi.hoisted(() => ({ app: false }))
vi.mock('../lib/native', async (importOriginal) => ({ ...(await importOriginal<object>()), isNativeApp: () => native.app }))

const { useWorkspaceStore } = await import('../store/useWorkspaceStore')
const { useDashboardsStore } = await import('../store/useDashboardsStore')
const { useActiveDashboardStore } = await import('../store/useActiveDashboardStore')
const { AppMenu } = await import('./AppMenu')

function dashboard(id: string, name: string, order: number): Dashboard {
  return { id, name, order, widgets: [], layouts: {}, visibility: 'public' }
}

beforeEach(() => {
  native.app = false
  useDashboardsStore.setState({ dashboards: [] })
  useActiveDashboardStore.setState({ byWorkspace: {} })
})

describe('AppMenu', () => {
  it('offers exactly the three top-level modes (Boards/Bibliothek/System)', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    const onSelectMode = vi.fn()
    const onClose = vi.fn()
    render(<AppMenu mode="boards" onSelectMode={onSelectMode} onClose={onClose} />)

    // Navigation rows below each other, the current one marked and stage-sized (Marco, 2026-10-16).
    const nav = screen.getByRole('navigation', { name: 'Ansicht' })
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Boards', 'Bibliothek', 'System'])
    expect(within(nav).getByRole('button', { name: 'Boards' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'Boards' })).toHaveClass('h-stage')
    expect(screen.queryByRole('button', { name: 'Plugins' })).not.toBeInTheDocument()
    fireEvent.click(within(nav).getByRole('button', { name: 'System' }))
    expect(onSelectMode).toHaveBeenCalledWith('system')
    expect(onClose).toHaveBeenCalled()
  })

  it('without status bar the drawer starts below its empty place, so the entries stay where they are with it (Marco 2026-10-17)', () => {
    const { rerender } = render(<AppMenu mode="boards" onSelectMode={vi.fn()} onClose={vi.fn()} />)
    const backdrop = () => screen.getByRole('dialog').parentElement
    expect(backdrop()).toHaveClass('top-0')
    rerender(<AppMenu mode="boards" onSelectMode={vi.fn()} onClose={vi.fn()} clearCornerButtons />)
    expect(backdrop()).toHaveClass('top-14')
    expect(screen.getByRole('dialog').innerHTML).not.toContain('pt-20')
  })

  it('no longer shows the settings sections moved to SystemView (Darstellung, Sync, Speicher & Sync)', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    render(<AppMenu mode="boards" onSelectMode={vi.fn()} onClose={vi.fn()} />)

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
    render(<AppMenu mode="boards" onSelectMode={vi.fn()} onClose={vi.fn()} />)

    expect(screen.getByText('Anzeige')).toBeInTheDocument()
    expect(screen.getByText('Vollbild')).toBeInTheDocument()
  })

  it('#412: the native app always runs full screen - no Vollbild switch there', () => {
    Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
    Object.defineProperty(document.documentElement, 'requestFullscreen', { value: vi.fn(), configurable: true })
    native.app = true
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    render(<AppMenu mode="boards" onSelectMode={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText('Vollbild')).not.toBeInTheDocument()
  })

  it('2026-09-02: no longer shows "Wer bin ich" - band/profile switching moved to BandManagementView.tsx\'s "Band" tab', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    render(<AppMenu mode="boards" onSelectMode={vi.fn()} onClose={vi.fn()} />)

    expect(screen.queryByText('Wer bin ich')).not.toBeInTheDocument()
  })

  it('is a drawer from the left without the dashboard list - that moved to the bento menu (docs/15 D8)', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'band-a', name: 'Band A' }], activeWorkspaceId: 'band-a' })
    useDashboardsStore.setState({ dashboards: [dashboard('d1', 'Bühne', 0)] })
    render(<AppMenu mode="boards" onSelectMode={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('dialog', { name: 'Menü' })).toHaveAttribute('data-side', 'left')
    expect(screen.queryByText('Bühne')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument()
  })
})

describe('AppMenu closing', () => {
  it('closes with "Fertig" in the fixed bottom row, outside the scrolling list (#376, docs/15 D6)', () => {
    const onClose = vi.fn()
    render(<AppMenu mode="boards" onSelectMode={vi.fn()} onClose={onClose} />)
    const done = screen.getByRole('button', { name: 'Fertig' })
    const firstMode = screen.getByRole('button', { name: 'Boards' })
    // Never scrolls away: outside the scroll container that holds the entries.
    expect(done.closest('.overflow-y-auto')).toBeNull()
    expect(firstMode.closest('.overflow-y-auto')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /Schließen/ })).not.toBeInTheDocument()
    fireEvent.click(done)
    expect(onClose).toHaveBeenCalled()
  })
})
