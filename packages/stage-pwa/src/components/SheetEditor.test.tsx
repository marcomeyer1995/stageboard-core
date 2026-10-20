import { act, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Song, SongVariant } from 'shared-types'

// Every *Store.ts pulls in a real PouchDB at import time (createWorkspaceCollection et al.),
// unavailable under happy-dom - same stand-in as LibraryView.test.tsx/Dashboard.test.tsx.
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

const song: Song = {
  id: 'song-1',
  title: 'Sweet Child O’ Mine',
  artist: 'Guns N’ Roses',
  bpm: 125,
  timeSignature: '4/4',
  clickTrackEnabled: false,
  chordProContent: '[Verse]\n[C]Take my [G]hand',
  timecodes: [],
}

const variant: SongVariant = {
  id: 'variant-1',
  songId: song.id,
  label: 'Original',
  isDefault: true,
  bpm: song.bpm,
  timeSignature: song.timeSignature,
  clickTrackEnabled: song.clickTrackEnabled,
  chordProContent: song.chordProContent,
  timecodes: [],
  cues: [],
  countInEnabled: false,
  countInBars: 1,
  tracks: [],
}

// SheetEditor only needs `variantToOpen`/`getTrack` (plus delete/set-default) from here - mocked directly so
// these layout-focused tests don't also have to exercise the real PouchDB-backed persistence
// pipeline (variant creation, the legacy backing-track migration, etc.) just to render.
vi.mock('../lib/songVariantsDb', () => ({
  variantToOpen: vi.fn(async () => variant),
  getTrack: vi.fn(async () => null),
  deleteVariant: vi.fn(async () => {}),
  setDefaultVariant: vi.fn(async () => {}),
}))

const { SheetEditor } = await import('./SheetEditor')
const { useSongsStore } = await import('../store/useSongsStore')

/** Drives `useEditorLayout` (#177) - matches Tailwind's own breakpoints so the test stays a
 * faithful stand-in for a real viewport rather than an arbitrary fixture. `orientation` is one
 * field, not a `portrait` boolean, so the portrait and landscape queries stay each other's
 * complement instead of drifting out of sync. */
function stubViewport(opts: {
  width1280?: boolean
  width1024?: boolean
  width768?: boolean
  width640?: boolean
  orientation?: 'portrait' | 'landscape'
}) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      let matches = false
      if (query.includes('1280')) matches = !!opts.width1280
      else if (query.includes('1024')) matches = !!opts.width1024
      else if (query.includes('768')) matches = !!opts.width768
      else if (query.includes('640')) matches = !!opts.width640
      else if (query.includes('orientation: portrait')) matches = opts.orientation === 'portrait'
      else if (query.includes('orientation: landscape')) matches = opts.orientation === 'landscape'
      return {
        matches,
        addEventListener: () => {},
        removeEventListener: () => {},
      } as unknown as MediaQueryList
    }),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Renders with a real, already-loaded song - `songId`/`variantId`/`onBack` are all required
 * now (SheetEditor no longer supports an unsaved/"new song" draft - creation moved to
 * LibraryView's own "+ Neu"). `findByLabelText` (not `getByLabelText`) for the first assertion
 * lets the async `selectSong`/`variantToOpen` load settle before asserting. */
async function renderLoaded(songOverride: Song = song) {
  useSongsStore.setState({ songs: [songOverride] })
  render(<SheetEditor songId={songOverride.id} variantId={null} onBack={vi.fn()} />)
  await screen.findByRole('button', { name: 'Song-Angaben' })
}

const chordProPlaceholder = "[00:00.00] Come on baby [G] don't you wanna go"

describe('SheetEditor - song details as a summary line (#603)', () => {
  it('phone: one summary line until opened; stays open while sections change', async () => {
    stubViewport({ orientation: 'portrait' })
    await renderLoaded()

    const summary = screen.getByRole('button', { name: 'Song-Angaben' })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(summary).toHaveTextContent('Sweet Child O’ Mine · Guns N’ Roses · 125 BPM')
    expect(screen.queryByLabelText('Titel')).not.toBeInTheDocument()

    fireEvent.click(summary)
    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
    expect(screen.getByLabelText('Band')).toBeInTheDocument()
    expect(screen.getByLabelText('Key')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ändern…' })).toBeInTheDocument() // Tonart & Stimmung
    expect(screen.getByLabelText('Akkorde notiert für')).toBeInTheDocument()
    expect(screen.getByLabelText('Capo')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Tempo & Klick/ }))
    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
  })

  it('opens by itself for a song without a title (a new one); landscape/desktop: see below', async () => {
    stubViewport({ orientation: 'portrait' })
    await renderLoaded({ ...song, title: '' })
    expect(screen.getByRole('button', { name: 'Song-Angaben' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
  })

  it('has no separate Arrangement tab or accordion', async () => {
    stubViewport({ orientation: 'portrait' })
    await renderLoaded()
    expect(screen.queryByRole('button', { name: 'Arr.' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Arrangement/ })).not.toBeInTheDocument()
  })
})

describe('SheetEditor - phone/tablet portrait: accordions instead of a tab strip (#603)', () => {
  for (const [name, viewport] of [
    ['phone portrait', { orientation: 'portrait' as const }],
    ['tablet portrait', { width640: true, orientation: 'portrait' as const }],
  ] as const) {
    it(`${name}: Text/Tempo & Klick/Audio/Kommentare start collapsed and open independently, no tab strip`, async () => {
      stubViewport(viewport)
      await renderLoaded()

      expect(screen.queryByRole('tablist', { name: 'Bereich' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Cues' })).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText(chordProPlaceholder)).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Text', expanded: false }))
      expect(screen.getByPlaceholderText(chordProPlaceholder)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Tempo & Klick/ }))
      expect(screen.getByLabelText('Takt')).toBeInTheDocument()
      expect(screen.getByPlaceholderText(chordProPlaceholder)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Audio', expanded: false }))
      expect(screen.getByText('Keine Tracks')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Kommentare', expanded: false }))
      expect(screen.getByText(/Noch keine Kommentare/)).toBeInTheDocument()
    })
  }

  it('one Speichern, in the header - not at the end of the page', async () => {
    stubViewport({ orientation: 'portrait' })
    await renderLoaded()
    const save = screen.getAllByRole('button', { name: 'Speichern' })
    expect(save).toHaveLength(1)
    // Before the content: the header comes first in document order.
    expect(save[0]!.compareDocumentPosition(screen.getByRole('button', { name: 'Song-Angaben' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('SheetEditor - "+ Kommentar" button (issue #215 follow-up)', () => {
  it('inserts a blank {cc: } directive into the ChordPro text, immediately listed under Kommentare', async () => {
    stubViewport({ orientation: 'portrait' })
    await renderLoaded()

    // Not queried by accessible name (getByRole): this button sits inside the same <label> as
    // several siblings, so its computed accessible name absorbs the whole label's text (a
    // pre-existing quirk of every button in this row, not something #215 introduced).
    fireEvent.click(screen.getByRole('button', { name: 'Text', expanded: false }))
    fireEvent.click(screen.getByText('+ Kommentar'))
    const textarea = screen.getByPlaceholderText(chordProPlaceholder) as HTMLTextAreaElement
    expect(textarea.value).toContain('{cc: }')

    fireEvent.click(screen.getByRole('button', { name: 'Kommentare', expanded: false }))
    expect(screen.queryByText(/Noch keine Kommentare/)).not.toBeInTheDocument()
  })
})

describe('SheetEditor - landscape/desktop: every section collapsible, all start collapsed', () => {
  it('desktop: no tab switcher; Text/Tempo & Klick/Audio all start collapsed, expand independently', async () => {
    stubViewport({ width1280: true, width1024: true, width768: true })
    await renderLoaded()

    expect(screen.queryAllByRole('button', { name: 'Text' }).filter((b) => !b.hasAttribute('aria-expanded'))).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: 'Tempo' }).filter((b) => !b.hasAttribute('aria-expanded'))).toHaveLength(0)

    // Header always visible; everything collapsible starts collapsed.
    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(chordProPlaceholder)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Takt')).not.toBeInTheDocument()
    expect(screen.queryByText('Keine Tracks')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Text', expanded: false }))
    expect(screen.getByPlaceholderText(chordProPlaceholder)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Tempo & Klick/ }))
    expect(screen.getByLabelText('Takt')).toBeInTheDocument()
    // Expanding Tempo & Klick didn't collapse Text.
    expect(screen.getByPlaceholderText(chordProPlaceholder)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Audio', expanded: false }))
    expect(screen.getByText('Keine Tracks')).toBeInTheDocument()

    // No Cues section any more - cues are placed in the timeline (#602).
    expect(screen.queryByRole('button', { name: 'Cues' })).not.toBeInTheDocument()
  })

  it('landscape below xl: same all-collapsed default as desktop', async () => {
    stubViewport({ width1024: true, width768: true })
    await renderLoaded()

    expect(screen.queryByPlaceholderText(chordProPlaceholder)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Takt')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Tempo & Klick/ }))
    expect(screen.getByLabelText('Takt')).toBeInTheDocument()
  })

  it('landscape tablet under 1024px wide: gets the panel layout, not the tab switcher', async () => {
    // md (768px) and landscape, but short of lg (1024px) - the one 'panel' condition that
    // isn't just "width >= 1024".
    stubViewport({ width768: true, orientation: 'landscape' })
    await renderLoaded()

    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: 'Text' }).filter((b) => !b.hasAttribute('aria-expanded'))).toHaveLength(0)
    expect(screen.getByRole('button', { name: /Tempo & Klick/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Takt')).not.toBeInTheDocument()
  })
})

describe('SheetEditor - song switching moved to LibraryView', () => {
  it('has no Song dropdown, no "+ Neuer Song", and no "Song löschen" - only "← Bibliothek"', async () => {
    stubViewport({ width1280: true, width1024: true, width768: true })
    await renderLoaded()

    expect(screen.queryByLabelText('Song')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Neuer Song' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Song löschen' })).not.toBeInTheDocument()
    // Icon-only on the phone, with its word from 600 px - one of the two is shown (CSS).
    expect(screen.getAllByRole('button', { name: 'Bibliothek' }).length).toBeGreaterThan(0)
  })
})

describe('SheetEditor - song not in the store yet when the editor opens', () => {
  // LibraryView's "+ Neu" saves the song to PouchDB and opens the editor right away; the songs
  // store only picks the new song up a moment later (change feed -> refreshSongs). The editor
  // must load it once it arrives instead of staying on "Lade…" forever.
  it('loads the song as soon as it reaches the store', async () => {
    stubViewport({ orientation: 'portrait' })
    useSongsStore.setState({ songs: [] })
    render(<SheetEditor songId={song.id} variantId={null} onBack={vi.fn()} />)
    expect(screen.getByText('Lade…')).toBeInTheDocument()

    act(() => useSongsStore.setState({ songs: [song] }))

    expect(await screen.findByRole('button', { name: 'Song-Angaben' })).toBeInTheDocument()
  })

  it('switches to a full-screen timeline and back, keeping Speichern at hand (docs/14)', async () => {
    stubViewport({ orientation: 'landscape' })
    await renderLoaded()
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(screen.getByLabelText('Timeline', { selector: ':not([role=tab])' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Song-Angaben' })).not.toBeInTheDocument() // the text editor is gone
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Text' }))
    expect(screen.getByRole('button', { name: 'Song-Angaben' })).toBeInTheDocument()
  })

  it('keeps the rigid click grid when saving (docs/14 §5a)', async () => {
    stubViewport({ orientation: 'landscape' })
    const beatGrid = { points: [{ id: 'p1', bar: 1, timeMs: 1200 }], meters: [] }
    const { variantToOpen } = await import('../lib/songVariantsDb')
    vi.mocked(variantToOpen).mockResolvedValueOnce({ ...variant, beatGrid })
    const saveVariant = vi.fn(async () => {})
    const { useSongVariantsStore } = await import('../store/useSongVariantsStore')
    useSongVariantsStore.setState({ saveVariant })
    await renderLoaded()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Speichern' })))
    expect(saveVariant).toHaveBeenCalledWith(expect.objectContaining({ beatGrid }))
  })
})

