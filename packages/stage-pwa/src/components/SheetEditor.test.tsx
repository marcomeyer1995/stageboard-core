import { render, screen, fireEvent } from '@testing-library/react'
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
  beatAnchors: [],
  tempoMarkers: [],
  countInEnabled: false,
  countInBars: 1,
  tracks: [],
}

// SheetEditor only needs `ensureDefaultVariant`/`getTrack` from here - mocked directly so
// these layout-focused tests don't also have to exercise the real PouchDB-backed persistence
// pipeline (variant creation, the legacy backing-track migration, etc.) just to render.
vi.mock('../lib/songVariantsDb', () => ({
  ensureDefaultVariant: vi.fn(async () => variant),
  getTrack: vi.fn(async () => null),
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
 * lets the async `selectSong`/`ensureDefaultVariant` load settle before asserting. */
async function renderLoaded() {
  useSongsStore.setState({ songs: [song] })
  render(<SheetEditor songId={song.id} variantId={null} onBack={vi.fn()} />)
  await screen.findByLabelText('Titel')
}

const chordProPlaceholder = "[00:00.00] Come on baby [G] don't you wanna go"

describe('SheetEditor - always-visible header (Titel/Band/Key/Tuning/Capo)', () => {
  it('stays visible on phone regardless of which tab is active', async () => {
    stubViewport({ orientation: 'portrait' })
    await renderLoaded()

    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
    expect(screen.getByLabelText('Band')).toBeInTheDocument()
    expect(screen.getByLabelText('Key')).toBeInTheDocument()
    expect(screen.getByLabelText('Tuning')).toBeInTheDocument()
    expect(screen.getByLabelText('Capo')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tempo' }))

    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
    expect(screen.getByLabelText('Key')).toBeInTheDocument()
  })

  it('has no separate Arrangement tab or accordion - it was folded into this header', async () => {
    stubViewport({ orientation: 'portrait' })
    await renderLoaded()
    expect(screen.queryByRole('button', { name: 'Arr.' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Arrangement/ })).not.toBeInTheDocument()

    stubViewport({ width1280: true, width1024: true, width768: true })
    await renderLoaded()
    expect(screen.queryByRole('button', { name: /Arrangement/ })).not.toBeInTheDocument()
  })
})

describe('SheetEditor - Text/Tempo/Audio/Cues/Kommentare tabs (phone/tablet portrait)', () => {
  it('phone portrait: five tabs, Text active by default', async () => {
    stubViewport({ orientation: 'portrait' })
    await renderLoaded()

    expect(screen.getByRole('button', { name: 'Text' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tempo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Audio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cues' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kommentare' })).toBeInTheDocument()

    expect(screen.getByPlaceholderText(chordProPlaceholder)).toBeInTheDocument()
    expect(screen.queryByLabelText('Takt')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tempo' }))
    expect(screen.getByLabelText('Takt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Track analysieren' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(chordProPlaceholder)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    expect(screen.getByText('Keine Tracks')).toBeInTheDocument()
    expect(screen.queryByText('Noch keine Cues für diese Variante.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cues' }))
    expect(screen.getByText('Noch keine Cues für diese Variante.')).toBeInTheDocument()
    expect(screen.queryByText('Keine Tracks')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Kommentare' }))
    expect(
      screen.getByText('Noch keine Kommentare - "+ Kommentar" im ChordPro-Text fügt einen an der Cursorposition ein.'),
    ).toBeInTheDocument()
  })

  it('tablet portrait: a tab opens as a sheet over Text, which stays mounted underneath', async () => {
    stubViewport({ width640: true, orientation: 'portrait' })
    await renderLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Tempo' }))

    expect(screen.getByLabelText('Takt')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(chordProPlaceholder)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fertig' })).toBeInTheDocument()
  })
})

describe('SheetEditor - "+ Kommentar" button (issue #215 follow-up)', () => {
  it('inserts a blank {cc: } directive into the ChordPro text, immediately listed in the Kommentare tab', async () => {
    stubViewport({ orientation: 'portrait' })
    await renderLoaded()

    // Not queried by accessible name (getByRole): this button sits inside the same <label> as
    // several siblings, so its computed accessible name absorbs the whole label's text (a
    // pre-existing quirk of every button in this row, not something #215 introduced).
    fireEvent.click(screen.getByText('+ Kommentar'))
    const textarea = screen.getByPlaceholderText(chordProPlaceholder) as HTMLTextAreaElement
    expect(textarea.value).toContain('{cc: }')

    fireEvent.click(screen.getByRole('button', { name: 'Kommentare' }))
    expect(screen.queryByText(/Noch keine Kommentare/)).not.toBeInTheDocument()
  })
})

describe('SheetEditor - landscape/desktop: every section collapsible, all start collapsed', () => {
  it('desktop: no tab switcher; Text/Tempo & Klick/Audio/Cues all start collapsed, expand independently', async () => {
    stubViewport({ width1280: true, width1024: true, width768: true })
    await renderLoaded()

    expect(screen.queryByRole('button', { name: 'Text' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tempo' })).not.toBeInTheDocument()

    // Header always visible; everything collapsible starts collapsed.
    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(chordProPlaceholder)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Takt')).not.toBeInTheDocument()
    expect(screen.queryByText('Keine Tracks')).not.toBeInTheDocument()
    expect(screen.queryByText('Noch keine Cues für diese Variante.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^.\s*Text$/ }))
    expect(screen.getByPlaceholderText(chordProPlaceholder)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Tempo & Klick/ }))
    expect(screen.getByLabelText('Takt')).toBeInTheDocument()
    // Expanding Tempo & Klick didn't collapse Text.
    expect(screen.getByPlaceholderText(chordProPlaceholder)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^.\s*Audio$/ }))
    expect(screen.getByText('Keine Tracks')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^.\s*Cues$/ }))
    expect(screen.getByText('Noch keine Cues für diese Variante.')).toBeInTheDocument()
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
    expect(screen.queryByRole('button', { name: 'Text' })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: '← Bibliothek' })).toBeInTheDocument()
  })
})
