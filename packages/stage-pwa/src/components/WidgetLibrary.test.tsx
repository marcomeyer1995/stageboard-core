import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Dashboard } from 'shared-types'

// registry.tsx statically imports every widget file, several of which transitively import
// workspaceDb.ts (a real PouchDB at module load time) - unavailable under happy-dom, same
// mock every other test touching the registry already needs (see cueFiring.test.ts).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { WidgetLibrary } = await import('./WidgetLibrary')

function dashboard(): Dashboard {
  return { id: 'd1', name: 'Test', order: 0, widgets: [], layouts: {}, visibility: 'public' }
}

describe('WidgetLibrary', () => {
  it('closes when the backdrop is clicked, not when the panel itself is', () => {
    const onClose = vi.fn()
    const { container } = render(
      <WidgetLibrary dashboard={dashboard()} capabilities={new Map()} onAdd={vi.fn()} onClose={onClose} />,
    )
    fireEvent.click(screen.getByText('Widget hinzufügen'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(container.firstElementChild!)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes via the ✕ button', () => {
    const onClose = vi.fn()
    render(<WidgetLibrary dashboard={dashboard()} capabilities={new Map()} onAdd={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByTitle('Schließen'))
    expect(onClose).toHaveBeenCalled()
  })

  it('adds a widget and reports the updated dashboard', () => {
    const onAdd = vi.fn()
    render(<WidgetLibrary dashboard={dashboard()} capabilities={new Map()} onAdd={onAdd} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Live-Queue'))
    expect(onAdd).toHaveBeenCalledTimes(1)
    const updated = onAdd.mock.calls[0][0] as Dashboard
    expect(updated.widgets).toHaveLength(1)
    expect(updated.widgets[0].type).toBe('live-queue')
  })

  it('filters by search term across title and description', () => {
    render(<WidgetLibrary dashboard={dashboard()} capabilities={new Map()} onAdd={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Widget suchen…'), { target: { value: 'Stimmgerät' } })
    expect(screen.getByText('Stimmgerät')).toBeInTheDocument()
    expect(screen.queryByText('Prompter')).not.toBeInTheDocument()
  })

  it('renders every offered widget tile with no uncaught error (live preview + error boundary)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(<WidgetLibrary dashboard={dashboard()} capabilities={new Map()} onAdd={vi.fn()} onClose={vi.fn()} />),
    ).not.toThrow()
    // "Keine Vorschau" only appears if a tile's preview actually crashed and the boundary
    // caught it - core widgets (requires: []) are expected to render cleanly with no config.
    expect(screen.queryByText('Keine Vorschau')).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('shows a static representative state for widgets whose real content is store-driven and empty during editing', () => {
    render(<WidgetLibrary dashboard={dashboard()} capabilities={new Map()} onAdd={vi.fn()} onClose={vi.fn()} />)
    // Tuner: a real idle mount would show "Mikrofon aktivieren", not a note/frequency.
    expect(screen.getByText('440.0 Hz')).toBeInTheDocument()
    // Visual metronome: a real idle mount (no song playing) would show "Wartet auf Play".
    expect(screen.getByText('120.0 BPM · 4/4')).toBeInTheDocument()
    expect(screen.queryByText('Wartet auf Play')).not.toBeInTheDocument()
    // Live-Queue: a real mount with no active setlist would show "Keine Setlist aktiv.".
    expect(screen.getByText('Highway to Hell')).toBeInTheDocument()
    expect(screen.queryByText('Keine Setlist aktiv.')).not.toBeInTheDocument()
  })
})
