import { act, fireEvent, render, screen, within } from '@testing-library/react'
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
  useWorkspaceStore.setState({
    workspaces: [],
    activeWorkspaceId: '',
    // Renders SystemSettings.tsx -> WorkspaceHardwareSettings.tsx, whose useStageServerStatus.ts
    // fires all three of these on mount (same "every test needs some stub for it" reasoning as
    // JoinBandView.test.tsx's default for listWorkspaces()) - without this, an unstubbed real
    // fetch to a fake test hostname was surfacing as a flaky "unhandled rejection" at teardown.
    listWorkspaces: vi.fn().mockResolvedValue(null),
    fetchActiveWorkspaceHardware: vi.fn().mockResolvedValue(null),
    fetchServerInfo: vi.fn().mockResolvedValue(null),
  })
})

/** Mutable matchMedia stand-in driving two independent axes: useInputCapability.ts's own
 * `(pointer: fine)`/`(hover: hover)` queries (both driven by one `pointer` flag here, since
 * these tests only need a clean pointer/touch toggle, not to distinguish the two queries from
 * each other) and useIsWideScreen's `(min-width: 1024px)` query, dispatched by matching "1024"
 * in the query string - same pattern SheetEditor.test.tsx's own stubViewport already uses. A
 * pointer downgrade (pointer -> touch) commits immediately with no mousemove corroboration
 * needed, per useInputCapability.ts's own doc comment, so `.set(...)` alone is enough to flip
 * either axis live. */
function stubMatchMedia(opts: { pointer: boolean; wide: boolean }) {
  const state = { ...opts }
  const listeners: Array<{ query: string; cb: () => void }> = []
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query.includes('1024') ? state.wide : state.pointer
      },
      addEventListener: (_: string, cb: () => void) => listeners.push({ query, cb }),
      removeEventListener: (_: string, cb: () => void) => {
        const i = listeners.findIndex((l) => l.query === query && l.cb === cb)
        if (i !== -1) listeners.splice(i, 1)
      },
    })),
  )
  return {
    set(next: Partial<typeof opts>) {
      Object.assign(state, next)
      listeners.forEach((l) => l.cb())
    },
  }
}

describe('SystemView', () => {
  it('tabs sorted by scope (System split, 2026-10-16); starts on Dieses Gerät and switches on click', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Dieses Gerät', 'Band', 'Bühnentechnik', 'Tablets & Handys', 'Stage-Server', 'Add-ons'])
    expect(screen.getByText('Dieses Gerät', { selector: 'h1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Add-ons' }))
    expect(screen.getByText('Add-ons', { selector: 'h1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Tablets & Handys' }))
    expect(screen.getByText('Tablets & Handys', { selector: 'h1' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Band' }))
    expect(screen.getByText('Band', { selector: 'h1' })).toBeInTheDocument()
  })

  it('Backup is part of Stage-Server, no tab of its own', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)
    expect(screen.queryByRole('tab', { name: 'Backup' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Stage-Server' }))
    expect(screen.getByRole('region', { name: 'Backup' })).toBeInTheDocument()
  })

  it('Dieses Gerät holds the moved-out device settings; Vollbild stays in the ☰ menu', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    expect(screen.getByText('Darstellung')).toBeInTheDocument()
    expect(screen.getByText('Speicher & Sync')).toBeInTheDocument()
    // Vollbild stays in AppMenu.tsx (Marco asked for it to remain directly reachable there),
    // not duplicated here.
    expect(screen.queryByText('Anzeige')).not.toBeInTheDocument()
  })
})

describe('SystemView - sidebar (pointer or wide screen) vs. tab strip (narrow touch), #179', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function expectSidebar() {
    const tabs = screen.getByRole('tablist', { name: 'System' })
    expect(tabs).toHaveAttribute('aria-orientation', 'vertical')
    expect(tabs.parentElement).toHaveClass('w-56')
  }

  function expectStrip() {
    const tabs = screen.getByRole('tablist', { name: 'System' })
    expect(tabs).toHaveAttribute('aria-orientation', 'horizontal')
    expect(tabs).toHaveClass('flex-wrap')
    // Phone width: one row scrolling sideways instead (Marco, 2026-10-16).
    expect(tabs).toHaveClass('max-[599px]:flex-nowrap', 'max-[599px]:overflow-x-auto')
  }

  it('pointer lane (happy-dom default): a vertical sidebar, not the horizontal strip', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)
    expectSidebar()
  })

  it('narrow touch: a wrapping tab strip (#373; one scrolling row on the phone), not the sidebar', () => {
    stubMatchMedia({ pointer: false, wide: false })
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)
    expectStrip()
  })

  it('wide touch (e.g. a tablet in landscape): the sidebar too, same as Bibliothek\'s own two-pane switch', () => {
    stubMatchMedia({ pointer: false, wide: true })
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)
    expectSidebar()
  })

  it('switching lanes mid-session (e.g. unplugging a mouse) keeps the active tab', () => {
    const media = stubMatchMedia({ pointer: true, wide: false })
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    fireEvent.click(screen.getByRole('tab', { name: 'Add-ons' }))
    expect(screen.getByText('Add-ons', { selector: 'h1' })).toBeInTheDocument()

    act(() => media.set({ pointer: false }))
    expectStrip()
    expect(screen.getByText('Add-ons', { selector: 'h1' })).toBeInTheDocument()
  })

  it('rotating a touch device mid-session (narrow -> wide) also keeps the active tab', () => {
    const media = stubMatchMedia({ pointer: false, wide: false })
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    fireEvent.click(screen.getByRole('tab', { name: 'Add-ons' }))
    expect(screen.getByText('Add-ons', { selector: 'h1' })).toBeInTheDocument()

    act(() => media.set({ wide: true }))
    expectSidebar()
    expect(screen.getByText('Add-ons', { selector: 'h1' })).toBeInTheDocument()
  })

  it('each setting sits in the tab of its scope: device, band, server (#371, System split)', () => {
    usePluginsStore.setState({ installed: [] })
    render(<SystemView />)

    const device = screen.getByRole('region', { name: 'Gerät' })
    expect(within(device).getByText('Gerätename')).toBeInTheDocument()
    expect(screen.getByText('Textgröße')).toBeInTheDocument()
    expect(screen.queryByText('Aktive Band (Hardware)')).not.toBeInTheDocument()

    // No "Ton & Timing" tab any more (Marco, 2026-10-16): latency in "Latenz…", Ansagen with its add-on, Web Audio in Diagnose.
    expect(screen.queryByRole('tab', { name: 'Ton & Timing' })).not.toBeInTheDocument()
    expect(screen.queryByText('Ton-Latenz ausgleichen')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Stage-Server' }))
    const connection = screen.getByRole('region', { name: 'Verbindung' })
    expect(within(connection).getByText('Stage-Server')).toBeInTheDocument()
    expect(within(connection).getByText('Synchronisation')).toBeInTheDocument()
    // "Band wechseln…" switches the server's band for everyone - its own, marked group.
    expect(within(screen.getByRole('region', { name: 'Aktive Band - gilt für alle' })).getByText('Aktive Band (Hardware)')).toBeInTheDocument()
    // Geübt / Geprobt count where they sort, in the Bibliothek.
    expect(screen.queryByText('Bibliothek - Geprobt')).not.toBeInTheDocument()
  })
})
