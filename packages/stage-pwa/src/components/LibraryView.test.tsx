import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song, Setlist } from 'shared-types'

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

describe('LibraryView', () => {
  beforeEach(() => {
    useSongsStore.setState({
      songs: [song('c', 'Charlie'), song('a', 'Alpha'), song('b', 'Bravo')],
    })
    useSetlistsStore.setState({
      setlists: [setlist('old', 'Older Gig', 1000), setlist('new', 'Newer Gig', 2000)],
    })
  })

  it('lists setlists newest-first and songs alphabetically by default', () => {
    render(<LibraryView />)
    const items = screen.getAllByRole('button').map((el) => el.textContent)
    const newerIndex = items.findIndex((t) => t?.includes('Newer Gig'))
    const olderIndex = items.findIndex((t) => t?.includes('Older Gig'))
    const alphaIndex = items.findIndex((t) => t?.includes('Alpha'))
    const bravoIndex = items.findIndex((t) => t?.includes('Bravo'))
    const charlieIndex = items.findIndex((t) => t?.includes('Charlie'))

    expect(newerIndex).toBeGreaterThanOrEqual(0)
    expect(newerIndex).toBeLessThan(olderIndex)
    expect(alphaIndex).toBeLessThan(bravoIndex)
    expect(bravoIndex).toBeLessThan(charlieIndex)
  })

  it('the Setlists filter chip hides the Songs section', () => {
    render(<LibraryView />)
    fireEvent.click(screen.getByRole('button', { name: 'Setlists' }))
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
    expect(screen.getByText(/Newer Gig/)).toBeInTheDocument()
  })

  it('the Songs filter chip hides the Setlists section', () => {
    render(<LibraryView />)
    fireEvent.click(screen.getByRole('button', { name: 'Songs' }))
    expect(screen.queryByText(/Newer Gig/)).not.toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
  })

  it('search filters both sections at once', () => {
    render(<LibraryView />)
    fireEvent.change(screen.getByPlaceholderText('Songs & Setlists durchsuchen…'), { target: { value: 'new' } })
    expect(screen.getByText(/Newer Gig/)).toBeInTheDocument()
    expect(screen.queryByText(/Older Gig/)).not.toBeInTheDocument()
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('Songs "+ Neu" creates a song from a title prompt and opens it, same shape as Setlists', async () => {
    // saveSong/remove are spied via setState rather than asserted through `songs` afterward -
    // the mocked PouchDB's changes() feed is a no-op stub (see the class above), so the store's
    // `songs` array never actually refreshes in this test environment even though the real
    // write happens; the point here is LibraryView's own wiring, not the store's sync plumbing.
    const saveSong = vi.fn(async () => {})
    useDialogStore.setState({ promptText: async () => 'Wonderwall' })
    useSongsStore.setState({ saveSong })
    render(<LibraryView />)

    const songsHeading = screen.getByRole('heading', { name: 'Songs' })
    fireEvent.click(within(songsHeading.parentElement!).getByRole('button', { name: '+ Neu' }))

    await screen.findByText('Song-Editor')
    expect(saveSong).toHaveBeenCalledWith(expect.objectContaining({ title: 'Wonderwall' }))
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
    expect(within(row).queryByRole('button', { name: '+' })).not.toBeInTheDocument()
  })

  it('pointer lane (happy-dom default): "+" button present, no swipe reveal', () => {
    render(<LibraryView />)

    const row = screen.getByText('Alpha').closest('li')!
    expect(within(row).queryByText('+ Zur aktiven Setlist')).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '+' })).toBeInTheDocument()
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
