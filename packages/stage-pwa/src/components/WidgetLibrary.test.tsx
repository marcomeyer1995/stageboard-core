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
    render(
      <WidgetLibrary dashboard={dashboard()} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={vi.fn()} onClose={onClose} />,
    )
    fireEvent.click(screen.getByText('Widget hinzufügen'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog', { name: 'Widget hinzufügen' }).parentElement!)
    expect(onClose).toHaveBeenCalled()
  })

  it('closes via "Abbrechen" at the bottom', () => {
    const onClose = vi.fn()
    render(<WidgetLibrary dashboard={dashboard()} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('adds a widget and reports the updated dashboard', () => {
    const onAdd = vi.fn()
    render(<WidgetLibrary dashboard={dashboard()} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={onAdd} onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Live-Queue'))
    expect(onAdd).toHaveBeenCalledTimes(1)
    const updated = onAdd.mock.calls[0][0] as Dashboard
    expect(updated.widgets).toHaveLength(1)
    expect(updated.widgets[0].type).toBe('live-queue')
  })

  it('filters by search term across title and description', () => {
    render(<WidgetLibrary dashboard={dashboard()} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('Widget suchen…'), { target: { value: 'Stimmgerät' } })
    expect(screen.getByText('Stimmgerät')).toBeInTheDocument()
    expect(screen.queryByText('Prompter')).not.toBeInTheDocument()
  })

  it('lists title matches first while searching, ahead of description-only matches', () => {
    render(<WidgetLibrary dashboard={dashboard()} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={vi.fn()} onClose={vi.fn()} />)
    const titles = (term: string) => {
      fireEvent.change(screen.getByPlaceholderText('Widget suchen…'), { target: { value: term } })
      return [...document.querySelectorAll<HTMLElement>('div[role=button][title] .px-3 .font-semibold')].map((el) => el.textContent)
    }
    // GUI audit: "Uhr" listed Festival-Uhr first, "Klick" listed Tempo-Korrektur first.
    expect(titles('uhr')[0]).toBe('Uhr')
    expect(titles('klick')[0]).toBe('Klick')
    expect(screen.getByText('Treffer')).toBeInTheDocument()
  })

  describe('no room at full size (GUI audit 2026-09-26)', () => {
    function full(): Dashboard {
      return {
        ...dashboard(),
        widgets: [{ i: 'p', type: 'prompter', frameless: false }],
        layouts: { md: [{ i: 'p', x: 0, y: 0, w: 12, h: 24 }] },
      }
    }

    it('asks instead of silently squeezing the widget in', () => {
      const onAdd = vi.fn()
      const onAddToNewDashboard = vi.fn()
      render(<WidgetLibrary dashboard={full()} breakpoint="md" capabilities={new Map()} onAdd={onAdd} onAddToNewDashboard={onAddToNewDashboard} onClose={vi.fn()} />)
      fireEvent.click(screen.getByText('Live-Queue'))
      expect(onAdd).not.toHaveBeenCalled()
      expect(screen.getByRole('dialog', { name: /Kein Platz für „Live-Queue“/ })).toBeInTheDocument()

      fireEvent.click(screen.getByText('Neues Dashboard mit diesem Widget'))
      expect(onAddToNewDashboard).toHaveBeenCalledWith(expect.objectContaining({ type: 'live-queue' }))
    })

    it('still adds it on "Trotzdem hier hinzufügen"', () => {
      const onAdd = vi.fn()
      render(<WidgetLibrary dashboard={full()} breakpoint="md" capabilities={new Map()} onAdd={onAdd} onAddToNewDashboard={vi.fn()} onClose={vi.fn()} />)
      fireEvent.click(screen.getByText('Live-Queue'))
      fireEvent.click(screen.getByText('Trotzdem hier hinzufügen'))
      expect((onAdd.mock.calls[0][0] as Dashboard).widgets).toHaveLength(2)
    })

    it('checks the grid the device shows - a free landscape grid does not help in portrait', () => {
      const onAdd = vi.fn()
      render(<WidgetLibrary dashboard={full()} breakpoint="lg" capabilities={new Map()} onAdd={onAdd} onAddToNewDashboard={vi.fn()} onClose={vi.fn()} />)
      fireEvent.click(screen.getByText('Live-Queue'))
      expect(onAdd).toHaveBeenCalledTimes(1)
    })
  })

  it('renders every offered widget tile with no uncaught error (live preview + error boundary)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(<WidgetLibrary dashboard={dashboard()} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={vi.fn()} onClose={vi.fn()} />),
    ).not.toThrow()
    // "Keine Vorschau" only appears if a tile's preview actually crashed and the boundary
    // caught it - core widgets (requires: []) are expected to render cleanly with no config.
    expect(screen.queryByText('Keine Vorschau')).not.toBeInTheDocument()
    spy.mockRestore()
  })

  it('shows a static representative state for widgets whose real content is store-driven and empty during editing', () => {
    render(<WidgetLibrary dashboard={dashboard()} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={vi.fn()} onClose={vi.fn()} />)
    // Tuner: a real idle mount would show "Mikrofon aktivieren", not a note/frequency.
    expect(screen.getByText('440.0 Hz')).toBeInTheDocument()
    // Visual metronome: a real idle mount (no song playing) would show "Wartet auf Play".
    expect(screen.getByText('120.0 BPM · 4/4')).toBeInTheDocument()
    expect(screen.queryByText('Wartet auf Play')).not.toBeInTheDocument()
    // Live-Queue: a real mount with no active setlist would show "Keine Setlist aktiv.".
    expect(screen.getByText('Highway to Hell')).toBeInTheDocument()
    expect(screen.queryByText('Keine Setlist aktiv.')).not.toBeInTheDocument()
  })

  describe('stage tiers (2026-09-27)', () => {
    function card(title: string): HTMLElement {
      // The title in the card's info area - previews render their own bold text too.
      return [...document.querySelectorAll<HTMLElement>('div[role=button][title]')].find(
        (c) => c.querySelector('.px-3 .font-semibold')?.textContent === title,
      )!
    }

    it('badges every widget with its tier (layout-only widgets get none)', () => {
      render(<WidgetLibrary dashboard={dashboard()} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={vi.fn()} onClose={vi.fn()} />)
      expect(card('Prompter').textContent).toContain('Gig')
      expect(card('Show-Notizen').textContent).toContain('Gig-Blick')
      expect(card('Quintenzirkel').textContent).toContain('Probe')
    })

    it('notes a rehearsal widget on a dashboard also offered in Gig mode, but not on a Solo-only one', () => {
      const { unmount } = render(<WidgetLibrary dashboard={dashboard()} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={vi.fn()} onClose={vi.fn()} />)
      expect(card('Quintenzirkel').textContent).toContain('auch im Gig verfügbar')
      expect(card('Prompter').textContent).not.toContain('auch im Gig verfügbar')
      unmount()

      render(<WidgetLibrary dashboard={{ ...dashboard(), modes: ['practice'] }} breakpoint="md" capabilities={new Map()} onAddToNewDashboard={vi.fn()} onAdd={vi.fn()} onClose={vi.fn()} />)
      expect(card('Quintenzirkel').textContent).not.toContain('auch im Gig verfügbar')
    })
  })
})
