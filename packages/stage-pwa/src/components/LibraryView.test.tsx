import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHOW_STATE, type Song, type Setlist } from 'shared-types'

// Every *Store.ts pulls in a real PouchDB at import time (createWorkspaceCollection et al.),
// unavailable under happy-dom - same stand-in as Dashboard.test.tsx/songVariantsDb.test.ts.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    async get() {
      throw Object.assign(new Error('missing'), { status: 404 })
    }
    async put() {
      return { ok: true, id: '', rev: '1-fake' }
    }
    async allDocs() {
      return { rows: [] }
    }
    changes() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

// LibraryView's own song-creation/deletion/selection wiring is what these tests exercise
// (#181's harmonized-with-setlists follow-up); SheetEditor's own async load pipeline is
// covered by SheetEditor.test.tsx and SongPreview's own by SongPreview.test.tsx, so both are
// stubbed out here rather than pulled in for real.
vi.mock('./SheetEditor', () => ({ SheetEditor: () => <div>Song-Editor</div> }))
vi.mock('./SongPreview', () => ({
  SongPreview: ({ songId, onEdit }: { songId: string; onEdit: () => void }) => (
    <div>
      Song-Preview-{songId}
      <button type="button" onClick={onEdit}>
        Bearbeiten
      </button>
    </div>
  ),
}))

const { useSongsStore } = await import('../store/useSongsStore')
const { useSetlistsStore } = await import('../store/useSetlistsStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { useAudioPinsStore } = await import('../store/useAudioPinsStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const openTab = (name: 'Setlists' | 'Songs') => fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }))
const { LibraryView } = await import('./LibraryView')

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }
}

function setlist(id: string, name: string, createdAt: number): Setlist {
  return { id, name, entries: [], createdAt }
}

/** happy-dom's default matchMedia reports every query as matching, which is the 'pointer' lane
 * for useInputCapability.ts (confirmed live: the unstubbed render below showed the "+" button,
 * not the swipe reveal) - only the 'touch' lane needs stubbing here. */
function stubTouchLane() {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })))
}

/** Dispatches by query-string substring, same pattern SheetEditor.test.tsx's own stubViewport
 * and useIsPanelLayout.test.ts already use - independently drives useInputCapability.ts's
 * `(pointer: fine)`/`(hover: hover)` queries and useIsPanelLayout.ts's own three queries, so a
 * test can stub e.g. "touch lane, but landscape-tablet-wide" without the two axes fighting. */
function stubMedia(opts: { pointer: boolean; width1024: boolean; width768: boolean; landscape: boolean }) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      let matches = opts.pointer
      if (query.includes('1024')) matches = opts.width1024
      else if (query.includes('768')) matches = opts.width768
      else if (query.includes('landscape')) matches = opts.landscape
      return { matches, addEventListener: () => {}, removeEventListener: () => {} }
    }),
  )
}

describe('LibraryView', () => {
  beforeEach(() => {
    // Most of these are about songs - start on that tab; setlist tests switch (openTab).
    localStorage.setItem('stageboard-library-tab', 'songs')
    useSongsStore.setState({
      songs: [song('c', 'Charlie'), song('a', 'Alpha'), song('b', 'Bravo')],
    })
    useSetlistsStore.setState({
      setlists: [setlist('old', 'Older Gig', 1000), setlist('new', 'Newer Gig', 2000)],
    })
  })

  it('Setlists | Songs are page tabs: songs alphabetically, setlists by gig date (undated by name); the tab is remembered', () => {
    const { unmount } = render(<LibraryView />)
    const order = (names: string[]) => names.map((n) => screen.getAllByRole('button').findIndex((el) => el.textContent?.includes(n)))
    const [alpha, bravo, charlie] = order(['Alpha', 'Bravo', 'Charlie'])
    expect(alpha).toBeLessThan(bravo)
    expect(bravo).toBeLessThan(charlie)
    expect(screen.queryByText(/Newer Gig/)).not.toBeInTheDocument()

    openTab('Setlists')
    const [newer, older] = order(['Newer Gig', 'Older Gig'])
    expect(newer).toBeGreaterThanOrEqual(0)
    expect(newer).toBeLessThan(older)
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    unmount()

    render(<LibraryView />)
    expect(screen.getByRole('tab', { name: /^Setlists/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('songs of the active setlist get the yellow outline, the loaded one also "Aktuell"; songs outside it stay plain', () => {
    useSetlistsStore.setState({
      setlists: [{ ...setlist('new', 'Newer Gig', 2000), entries: [{ id: 'e1', songId: 'b', variantId: null, trackId: null }, { id: 'e2', songId: 'c', variantId: null, trackId: null }] }],
    })
    useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, activeSetlistId: 'new', activeEntryId: 'e2' } })
    render(<LibraryView />)
    const row = (name: string) => screen.getByText(name).closest('div.relative') as HTMLElement
    expect(row('Bravo')).toHaveClass('outline-accent')
    expect(row('Charlie')).toHaveClass('outline-accent')
    expect(row('Alpha')).not.toHaveClass('outline-accent')
    expect(within(row('Charlie')).getByText('Aktuell')).toBeInTheDocument()
    expect(within(row('Bravo')).queryByText('Aktuell')).not.toBeInTheDocument()
    useShowStateStore.setState({ state: DEFAULT_SHOW_STATE })
  })

  it('without an active setlist the loaded song alone gets outline and "Aktuell"', () => {
    useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, activeSetlistId: null, activeEntryId: 'b' } })
    render(<LibraryView />)
    const row = (name: string) => screen.getByText(name).closest('div.relative') as HTMLElement
    expect(row('Bravo')).toHaveClass('outline-accent')
    expect(within(row('Bravo')).getByText('Aktuell')).toBeInTheDocument()
    expect(row('Alpha')).not.toHaveClass('outline-accent')
    useShowStateStore.setState({ state: DEFAULT_SHOW_STATE })
  })

  it('sorting: a joined bar per tab - songs by artist, setlists A-Z; the choice is remembered', () => {
    localStorage.removeItem('stageboard-library-sort')
    useSongsStore.setState({ songs: [song('c', 'Charlie'), { ...song('a', 'Alpha'), artist: 'Zappa' }, { ...song('b', 'Bravo'), artist: 'Abba' }] })
    const { unmount } = render(<LibraryView />)
    fireEvent.click(screen.getByRole('radio', { name: 'Interpret' }))
    const titles = () => screen.getAllByRole('button').map((el) => el.textContent ?? '').filter((t) => /^(Alpha|Bravo|Charlie)/.test(t))
    expect([...new Set(titles().map((t) => t.slice(0, 5)))]).toEqual(['Bravo', 'Alpha', 'Charl'])
    openTab('Setlists')
    fireEvent.click(screen.getByRole('radio', { name: 'Name' }))
    const names = screen.getAllByRole('button').map((el) => el.textContent ?? '').filter((t) => /Gig/.test(t))
    expect(names[0]).toMatch(/^Newer/)
    expect(names[1]).toMatch(/^Older/)
    unmount()
    render(<LibraryView />)
    expect(screen.getByRole('radio', { name: 'Name ↑' })).toHaveAttribute('aria-checked', 'true')
    openTab('Songs')
    expect(screen.getByRole('radio', { name: 'Interpret ↑' })).toHaveAttribute('aria-checked', 'true')
    localStorage.removeItem('stageboard-library-sort')
  })

  it('leaving a setlist with unsaved changes asks first - "Weiter bearbeiten" keeps the editor', async () => {
    const askUnsaved = vi.fn<() => Promise<'save' | 'discard' | null>>(async () => null)
    useDialogStore.setState({ askUnsaved })
    render(<LibraryView />)
    openTab('Setlists')
    const row = (name: string) => screen.getAllByRole('button').find((el) => el.textContent?.startsWith(name))!
    fireEvent.click(row('Newer Gig'))
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Umbenannt' } })

    fireEvent.click(row('Older Gig'))
    await waitFor(() => expect(askUnsaved).toHaveBeenCalled())
    expect(screen.getByLabelText('Name')).toHaveValue('Umbenannt')

    askUnsaved.mockResolvedValue('discard')
    fireEvent.click(row('Older Gig'))
    expect(await screen.findByRole('heading', { name: /Older Gig/ })).toBeInTheDocument()
  })

  it('first tap ↑ ascending, tapping again ↓ descending, and back', () => {
    localStorage.removeItem('stageboard-library-sort')
    render(<LibraryView />)
    const first = () => [...new Set(screen.getAllByRole('button').map((el) => el.textContent ?? '').filter((t) => /^(Alpha|Bravo|Charlie)/.test(t)))][0]
    expect(first()).toMatch(/^Alpha/)
    expect(screen.getByRole('radio', { name: 'Titel ↑' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Titel ↑' }))
    expect(screen.getByRole('radio', { name: 'Titel ↓' })).toHaveAttribute('aria-checked', 'true')
    expect(first()).toMatch(/^Charlie/)
    fireEvent.click(screen.getByRole('radio', { name: 'Titel ↓' }))
    expect(first()).toMatch(/^Alpha/)
    localStorage.removeItem('stageboard-library-sort')
  })

  it('search looks into the open tab and points to hits in the other one', () => {
    render(<LibraryView />)
    openTab('Setlists')
    fireEvent.change(screen.getByPlaceholderText('Setlists durchsuchen…'), { target: { value: 'av' } })
    expect(screen.queryByText(/Newer Gig/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 Treffer unter Songs' }))
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('"Neue Setlist" below the list opens one dialog with name and optional songs; picked songs become the entries (#183)', async () => {
    localStorage.setItem('stageboard-library-tab', 'setlists')
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    render(<LibraryView />)

    fireEvent.click(screen.getByRole('button', { name: 'Neue Setlist' }))
    const dialog = screen.getByRole('dialog', { name: 'Neue Setlist' })
    fireEvent.change(within(dialog).getByLabelText('Name der neuen Setlist'), { target: { value: 'Sommerfest' } })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Alpha/ }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }))

    await waitFor(() =>
      expect(saveSetlist).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sommerfest', entries: [expect.objectContaining({ songId: 'a', variantId: null, trackId: null })] }),
      ),
    )
    expect(screen.queryByRole('dialog', { name: 'Neue Setlist' })).not.toBeInTheDocument()
  })

  it('"Neuer Song" below the list opens the guided new-song flow; nothing is saved before its last step (#182)', async () => {
    // saveSong is spied via setState rather than asserted through `songs` afterward - the mocked
    // PouchDB's changes() feed is a no-op stub, so the store's `songs` never refreshes here.
    const saveSong = vi.fn(async () => {})
    useSongsStore.setState({ saveSong })
    render(<LibraryView />)

    fireEvent.click(screen.getByRole('button', { name: 'Neuer Song' }))
    const wizard = screen.getByRole('dialog', { name: 'Neuer Song' })
    fireEvent.change(within(wizard).getByLabelText('Titel'), { target: { value: 'Wonderwall' } })
    fireEvent.click(within(wizard).getByRole('button', { name: 'Weiter' }))
    fireEvent.click(within(wizard).getByRole('button', { name: /Leer beginnen/ }))
    expect(saveSong).not.toHaveBeenCalled()
    fireEvent.click(within(wizard).getByRole('button', { name: 'Song anlegen' }))

    await screen.findByText('Song-Editor')
    expect(saveSong).toHaveBeenCalledWith(expect.objectContaining({ title: 'Wonderwall', bpm: 120, timeSignature: '4/4' }))
  })

  it('highlights the selected song row, same as a selected setlist', () => {
    render(<LibraryView />)
    const alphaRow = screen.getByText('Alpha').parentElement!
    expect(alphaRow).not.toHaveClass('bg-accent')

    fireEvent.click(screen.getByText('Alpha'))
    expect(alphaRow).toHaveClass('bg-accent')
  })

  it('clicking an already-selected song again deselects it and closes the preview', () => {
    render(<LibraryView />)
    const placeholder = 'Wähle links eine Setlist oder einen Song aus.'

    fireEvent.click(screen.getByText('Alpha'))
    expect(screen.getByText('Song-Preview-a')).toBeInTheDocument()
    expect(screen.queryByText(placeholder)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Alpha'))
    expect(screen.queryByText('Song-Preview-a')).not.toBeInTheDocument()
    expect(screen.getByText(placeholder)).toBeInTheDocument()
  })

  it('clicking an already-selected setlist again deselects it, same toggle as a song', () => {
    render(<LibraryView />)
    openTab('Setlists')
    const placeholder = 'Wähle links eine Setlist oder einen Song aus.'
    const newerButton = screen.getByRole('button', { name: /Newer Gig/ })

    fireEvent.click(newerButton)
    expect(newerButton).toHaveClass('bg-accent')
    expect(screen.queryByText(placeholder)).not.toBeInTheDocument()

    fireEvent.click(newerButton)
    expect(newerButton).not.toHaveClass('bg-accent')
    expect(screen.getByText(placeholder)).toBeInTheDocument()
  })

  it('clicking an existing song shows its preview first, not the editor directly - unlike "+ Neu"', () => {
    render(<LibraryView />)
    fireEvent.click(screen.getByText('Alpha'))

    expect(screen.getByText('Song-Preview-a')).toBeInTheDocument()
    expect(screen.queryByText('Song-Editor')).not.toBeInTheDocument()
  })

  it('the preview\'s "Bearbeiten" button is what actually opens the editor', () => {
    render(<LibraryView />)
    fireEvent.click(screen.getByText('Alpha'))
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))

    expect(screen.getByText('Song-Editor')).toBeInTheDocument()
  })

  it('a song row\'s ⋯ menu deletes it after confirming - same pattern as a setlist', async () => {
    const remove = vi.fn(async () => {})
    useDialogStore.setState({ confirm: async () => true })
    useSongsStore.setState({ remove })
    render(<LibraryView />)

    const row = screen.getByText('Alpha').closest('li')!
    fireEvent.click(within(row).getByTitle('Menü öffnen'))
    fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }))

    // handleDeleteSong is async (awaits the mocked confirm() first) - the click above only
    // starts it.
    await waitFor(() => expect(remove).toHaveBeenCalledWith('a'))
  })

  it('has no standalone 📌 button - Pin lives in the ⋯ menu, labeled by current state', () => {
    useAudioPinsStore.setState({ byWorkspace: { '': ['a'] } })
    render(<LibraryView />)

    expect(screen.queryByText('📌')).not.toBeInTheDocument()

    const alphaRow = screen.getByText('Alpha').closest('li')!
    fireEvent.click(within(alphaRow).getByTitle('Menü öffnen'))
    expect(screen.getByRole('button', { name: 'Offline-Pin entfernen' })).toBeInTheDocument()
  })

  it('a row\'s ⋯ menu toggles the pin', () => {
    const togglePin = vi.fn()
    useAudioPinsStore.setState({ togglePin })
    render(<LibraryView />)

    const bravoRow = screen.getByText('Bravo').closest('li')!
    fireEvent.click(within(bravoRow).getByTitle('Menü öffnen'))
    fireEvent.click(screen.getByRole('button', { name: 'Offline anheften' }))

    expect(togglePin).toHaveBeenCalledWith('', 'b')
  })
})

describe('LibraryView - "+" vs. swipe-to-add, gated by input capability', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('touch lane: swipe reveal present, no "+" button', () => {
    stubTouchLane()
    render(<LibraryView />)

    const row = screen.getByText('Alpha').closest('li')!
    expect(within(row).getByText('+ Zur aktiven Setlist')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Zur aktiven Setlist hinzufügen|Keine aktive Setlist/ })).not.toBeInTheDocument()
  })

  it('a song already in the active setlist: the swipe strip says it takes it out; the ⋯ menu removes its last entry, never the loaded one', async () => {
    const before = useSetlistsStore.getState()
    const saveSetlist = vi.fn()
    const gig = {
      ...setlist('new', 'Newer Gig', 2000),
      entries: [
        { id: 'e1', songId: 'b', variantId: null, trackId: null },
        { id: 'e2', songId: 'b', variantId: null, trackId: null },
        { id: 'e3', songId: 'c', variantId: null, trackId: null },
      ],
    }
    useSetlistsStore.setState({ setlists: [gig], saveSetlist })
    useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, activeSetlistId: 'new', activeEntryId: 'e3' } })

    stubTouchLane()
    const { unmount } = render(<LibraryView />)
    expect(within(screen.getByText('Bravo').closest('li')!).getByText('− Aus aktiver Setlist')).toBeInTheDocument()
    expect(within(screen.getByText('Alpha').closest('li')!).getByText('+ Zur aktiven Setlist')).toBeInTheDocument()
    unmount()
    vi.unstubAllGlobals()

    render(<LibraryView />) // pointer lane: the same through the ⋯ menu
    fireEvent.contextMenu(screen.getByText('Bravo').closest('div.relative')!)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aus aktiver Setlist entfernen' }))
    await waitFor(() => expect(saveSetlist).toHaveBeenCalledWith(expect.objectContaining({ entries: [gig.entries[0], gig.entries[2]] })))

    // Charlie is loaded right now - it stays, with a hint.
    saveSetlist.mockClear()
    fireEvent.contextMenu(screen.getByText('Charlie').closest('div.relative')!)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Aus aktiver Setlist entfernen' }))
    expect(saveSetlist).not.toHaveBeenCalled()
    expect(await screen.findByText('Gerade geladen - erst weiterschalten')).toBeInTheDocument()
    useShowStateStore.setState({ state: DEFAULT_SHOW_STATE })
    useSetlistsStore.setState({ setlists: before.setlists, saveSetlist: before.saveSetlist })
  })

  it('pointer lane (happy-dom default): "+" button present, no swipe reveal', () => {
    render(<LibraryView />)

    const row = screen.getByText('Alpha').closest('li')!
    expect(within(row).queryByText('+ Zur aktiven Setlist')).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Zur aktiven Setlist hinzufügen|Keine aktive Setlist/ })).toBeInTheDocument()
  })

  it('dragging itself is disabled in the pointer lane, not just the swipe fallback', () => {
    render(<LibraryView />)
    // dnd-kit reflects a disabled useDraggable via aria-disabled on the draggable node - the
    // whole row surface (parent of the title button), not just the title text itself, since
    // the entire row is the swipe/drag target, not only its text.
    expect(screen.getByText('Alpha').parentElement).toHaveAttribute('aria-disabled', 'true')
  })

  it('dragging stays enabled in the touch lane', () => {
    stubTouchLane()
    render(<LibraryView />)
    expect(screen.getByText('Alpha').parentElement).toHaveAttribute('aria-disabled', 'false')
  })

  it('the whole row is the swipe target, not just the title text (regression: used to be text-only)', () => {
    stubTouchLane()
    render(<LibraryView />)

    const titleButton = screen.getByText('Alpha')
    // dnd-kit only stamps 'aria-roledescription' onto the actual draggable node - the row
    // surface wrapping the title, not the title button itself.
    expect(titleButton).not.toHaveAttribute('aria-roledescription')
    expect(titleButton.parentElement).toHaveAttribute('aria-roledescription', 'draggable')
  })
})

describe('LibraryView - two-pane breakpoint moved to landscape-tablet-wide, not just lg (#178)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const placeholder = 'Wähle links eine Setlist oder einen Song aus.'

  it('narrow portrait: the right pane stays hidden until something is selected', () => {
    stubMedia({ pointer: false, width1024: false, width768: false, landscape: false })
    render(<LibraryView />)

    expect(screen.getByText(placeholder).parentElement).toHaveClass('hidden')
  })

  it('landscape tablet (touch, below 1024px but past the landscape threshold): both panes visible with nothing selected yet', () => {
    stubMedia({ pointer: false, width1024: false, width768: true, landscape: true })
    render(<LibraryView />)

    expect(screen.getByText(placeholder).parentElement).not.toHaveClass('hidden')
    expect(screen.getByText(placeholder).parentElement).toHaveClass('flex')
  })

  it('panel mode hides the mobile-only "← Bibliothek" back button once something is selected', () => {
    stubMedia({ pointer: false, width1024: false, width768: true, landscape: true })
    render(<LibraryView />)

    fireEvent.click(screen.getByText('Alpha'))
    expect(screen.getByRole('button', { name: 'Bibliothek' })).toHaveClass('hidden')
  })

  it('narrow portrait still shows the "← Bibliothek" back button once something is selected', () => {
    stubMedia({ pointer: false, width1024: false, width768: false, landscape: false })
    render(<LibraryView />)

    fireEvent.click(screen.getByText('Alpha'))
    expect(screen.getByRole('button', { name: 'Bibliothek' })).not.toHaveClass('hidden')
  })
})

describe('LibraryView - pointer-lane context menu & keyboard nav (#178)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    // A truthy activeSetlist (useQueue -> computeQueue) for "Zur aktiven Setlist hinzufügen"
    // to have somewhere real to add to.
    useShowStateStore.setState({ state: { ...DEFAULT_SHOW_STATE, activeSetlistId: 'old' } })
    // Zustand state isn't reset between tests in this file - an earlier describe block pins
    // 'a' (Alpha) and leaves it that way, which would otherwise flip the menu's pin-toggle
    // label out from under this block's own "Offline anheften" assertions.
    useAudioPinsStore.setState({ byWorkspace: {} })
    // This block's own "suppressed while a dialog is open" test sets a request and never
    // clears it - without this, every test declared after it would inherit dialogOpen: true.
    useDialogStore.setState({ request: null })
  })

  it('right-click on a song row (pointer lane) opens a context menu with all four actions', () => {
    render(<LibraryView />)

    fireEvent.contextMenu(screen.getByText('Alpha'))

    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zur aktiven Setlist hinzufügen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Duplizieren' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Offline anheften' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument()
  })

  it('right-click does nothing in the touch lane - no menu, native behavior untouched', () => {
    stubTouchLane()
    render(<LibraryView />)

    fireEvent.contextMenu(screen.getByText('Alpha'))

    expect(screen.queryByRole('button', { name: 'Zur aktiven Setlist hinzufügen' })).not.toBeInTheDocument()
  })

  it('"Zur aktiven Setlist hinzufügen" from the context menu adds the song to the active setlist', async () => {
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    render(<LibraryView />)

    fireEvent.contextMenu(screen.getByText('Alpha'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zur aktiven Setlist hinzufügen' }))

    await waitFor(() =>
      expect(saveSetlist).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'old', entries: [expect.objectContaining({ songId: 'a' })] }),
      ),
    )
  })

  it('"Duplizieren" from the context menu prompts for a title and duplicates the song', async () => {
    const duplicateSong = vi.fn(async () => null)
    useDialogStore.setState({ promptText: async () => 'Alpha (Kopie)' })
    useSongsStore.setState({ duplicateSong })
    render(<LibraryView />)

    fireEvent.contextMenu(screen.getByText('Alpha'))
    fireEvent.click(screen.getByRole('button', { name: 'Duplizieren' }))

    await waitFor(() => expect(duplicateSong).toHaveBeenCalledWith('a', 'Alpha (Kopie)'))
  })

  it('ArrowDown moves keyboard focus through the open tab\'s list, Enter opens the focused song', () => {
    render(<LibraryView />)

    // Songs tab, alphabetically (Alpha, Bravo, Charlie) - the first ArrowDown lands on Alpha.
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.getByText('Song-Preview-a')).toBeInTheDocument()
  })

  it('ArrowUp moves focus back up the list', () => {
    render(<LibraryView />)
    openTab('Setlists')

    fireEvent.keyDown(window, { key: 'ArrowDown' }) // Newer Gig
    fireEvent.keyDown(window, { key: 'ArrowDown' }) // Older Gig
    fireEvent.keyDown(window, { key: 'ArrowUp' }) // back to Newer Gig
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.getByRole('button', { name: /Newer Gig/ })).toHaveClass('bg-accent')
  })

  it('keyboard navigation does nothing in the touch lane', () => {
    stubTouchLane()
    render(<LibraryView />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.queryByText('Song-Preview-a')).not.toBeInTheDocument()
  })

  it('keyboard navigation is suppressed while a dialog is open', () => {
    useDialogStore.setState({
      request: { kind: 'confirm', title: 'x', confirmLabel: 'OK', danger: false, resolve: () => {} },
    })
    render(<LibraryView />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(screen.queryByText('Song-Preview-a')).not.toBeInTheDocument()
  })

  it('Ctrl+F focuses the search box', () => {
    render(<LibraryView />)

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })

    expect(screen.getByRole('textbox', { name: 'Suche' })).toHaveFocus()
  })
})
