import { act, render, screen, fireEvent, within } from '@testing-library/react'
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
  /** A touchscreen (`pointer: coarse`) - the ChordPro keys above the keyboard (#606). */
  coarse?: boolean
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
      else if (query.includes('pointer: coarse')) matches = !!opts.coarse
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
 * (creation moved to LibraryView's own "+ Neu"). Waits for the text field, the view the editor
 * opens on (#617), so the async `selectSong`/`variantToOpen` load has settled. */
async function renderLoaded(songOverride: Song = song, content?: string) {
  if (content !== undefined) {
    const { variantToOpen } = await import('../lib/songVariantsDb')
    vi.mocked(variantToOpen).mockResolvedValueOnce({ ...variant, chordProContent: content })
  }
  useSongsStore.setState({ songs: [songOverride] })
  render(<SheetEditor songId={songOverride.id} variantId={null} onBack={vi.fn()} />)
  return (await screen.findByRole('textbox', { name: 'ChordPro-Text' })) as HTMLTextAreaElement
}

const phone = { orientation: 'portrait' as const }
const desktop = { width1280: true, width1024: true, width768: true }
const tab = (name: string) => screen.getByRole('tab', { name })

describe('SheetEditor - header views Text · Vorschau · Timeline · Details (#617)', () => {
  it('phone: opens on the text alone; the views are tabs in the header, Speichern once, top right', async () => {
    stubViewport(phone)
    await renderLoaded()
    expect(['Text', 'Vorschau', 'Timeline', 'Details'].map((name) => tab(name).getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false'])
    expect(screen.getAllByRole('button', { name: 'Speichern' })).toHaveLength(1)
    // The text view is only the variant row and the text - no preview, no sections, no buttons.
    expect(screen.getByRole('combobox', { name: 'Variante' })).toBeInTheDocument()
    expect(document.querySelector('[data-source-line]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tempo & Klick' })).not.toBeInTheDocument()
    expect(screen.queryByText('Song importieren')).not.toBeInTheDocument()
  })

  it('phone: while the text field has the focus, the variant row steps aside', async () => {
    stubViewport(phone)
    // A phone with the keyboard up: ~400 px of page left.
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(400)
    const textarea = await renderLoaded()
    fireEvent.focus(textarea)
    expect(screen.queryByRole('combobox', { name: 'Variante' })).not.toBeInTheDocument()
    fireEvent.blur(textarea)
    expect(screen.getByRole('combobox', { name: 'Variante' })).toBeInTheDocument()
    height.mockRestore()
  })

  it('tablet in portrait: with enough height above the keyboard the variant row stays (Marco, 2026-10-28)', async () => {
    stubViewport(phone)
    // The visible area as the Redmi has it with the keyboard up (its brief ~300 px blip on the way
    // is filtered by the settled viewport - useSettledVisualViewport.test).
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(652)
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: Object.assign(new EventTarget(), { height: 652, offsetTop: 0 }) })
    try {
      const textarea = await renderLoaded()
      fireEvent.focus(textarea)
      expect(screen.getByRole('combobox', { name: 'Variante' })).toBeInTheDocument()
    } finally {
      Reflect.deleteProperty(window, 'visualViewport')
      height.mockRestore()
    }
  })

  it('wide screen: text and preview side by side, no Vorschau tab', async () => {
    stubViewport(desktop)
    await renderLoaded()
    expect(screen.queryByRole('tab', { name: 'Vorschau' })).not.toBeInTheDocument()
    expect(document.querySelector('[data-source-line]')).not.toBeNull()
  })

  it('Details: Song-Angaben (a summary line while closed), Tempo & Klick, Audio, Kommentare - all closed, open independently', async () => {
    stubViewport(phone)
    await renderLoaded()
    fireEvent.click(tab('Details'))

    const meta = screen.getByRole('button', { name: 'Song-Angaben' })
    expect(meta).toHaveAttribute('aria-expanded', 'false')
    expect(meta).toHaveTextContent('Sweet Child O’ Mine · Guns N’ Roses · 125 BPM')
    expect(screen.queryByLabelText('Titel')).not.toBeInTheDocument()
    fireEvent.click(meta)
    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
    expect(screen.getByLabelText('Key')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ändern…' })).toBeInTheDocument() // Tonart & Stimmung
    expect(screen.getByLabelText('Akkorde notiert für')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tempo & Klick' }))
    expect(screen.getByLabelText('Takt')).toBeInTheDocument()
    expect(screen.getByLabelText('Titel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    expect(screen.getByText('Keine Tracks')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kommentare' }))
    expect(screen.getByText(/Noch keine Kommentare/)).toBeInTheDocument()
    // No Cues section any more - cues are placed in the timeline (#602).
    expect(screen.queryByRole('button', { name: 'Cues' })).not.toBeInTheDocument()
  })

  it('Song-Angaben are open for a song without a title (a new one)', async () => {
    stubViewport(phone)
    await renderLoaded({ ...song, title: '' })
    fireEvent.click(tab('Details'))
    expect(screen.getByRole('button', { name: 'Song-Angaben' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('⋮ holds Einfügen, Song importieren and Tap-to-Sync', async () => {
    stubViewport(phone)
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Song-Editor' }))
    expect(screen.getByRole('button', { name: 'Song importieren' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tap-to-Sync starten' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Einfügen …' })).toBeInTheDocument()
  })

  it('"+ Kommentar": a band template for Marco and Jamie becomes {cc4Marco,Jamie: Solo 8 Takte} above the caret line (#608)', async () => {
    const { useProfilesStore } = await import('../store/useProfilesStore')
    const { useBandSettingsStore } = await import('../store/useBandSettingsStore')
    useProfilesStore.setState({ profiles: [{ id: 'p1', name: 'Marco' }, { id: 'p2', name: 'Jamie' }, { id: 'p3', name: 'Caro' }] as never })
    useBandSettingsStore.setState({ settings: { id: 'band', commentTemplates: ['Solo 8 Takte', 'A cappella'] } })
    stubViewport(phone)
    const textarea = await renderLoaded()
    textarea.setSelectionRange(textarea.value.indexOf('[C]'), textarea.value.indexOf('[C]'))
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Song-Editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Einfügen …' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Kommentar' }))
    const dialog = screen.getByRole('dialog', { name: 'Kommentar einfügen' })
    expect(within(dialog).getByRole('button', { name: 'Einfügen' })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Solo 8 Takte' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marco' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Jamie' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Einfügen' }))
    expect(textarea.value).toBe('[Verse]\n{cc4Marco,Jamie: Solo 8 Takte}\n[C]Take my [G]hand')
    useProfilesStore.setState({ profiles: [] })
    useBandSettingsStore.setState({ settings: { id: 'band' } })
  })

  it('"+ Tab" for Marco inserts {sot4Marco}, a six-string skeleton and {end_of_tab} (#608)', async () => {
    const { useProfilesStore } = await import('../store/useProfilesStore')
    useProfilesStore.setState({ profiles: [{ id: 'p1', name: 'Marco' }] as never })
    stubViewport(phone)
    const textarea = await renderLoaded()
    textarea.setSelectionRange(0, 0)
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Song-Editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Einfügen …' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Tab' }))
    const dialog = screen.getByRole('dialog', { name: 'Tab einfügen' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marco' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Einfügen' }))
    const lines = textarea.value.split('\n')
    expect(lines.slice(0, 8)).toEqual(['{sot4Marco}', 'e|----------------|', 'B|----------------|', 'G|----------------|', 'D|----------------|', 'A|----------------|', 'E|----------------|', '{end_of_tab}'])
    useProfilesStore.setState({ profiles: [] })
  })

  it('"+ Neue Variante" is an AddRow below the variant select, not in its ⋯ (2026-10-20)', async () => {
    stubViewport(phone)
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Neue Variante' }))
    expect(screen.getByRole('combobox', { name: 'Variante' })).toHaveDisplayValue('Neue Variante (neu)')
    // Nothing to do with an unsaved variant yet - no empty ⋯.
    expect(screen.queryByRole('button', { name: /^Menü: Variante/ })).not.toBeInTheDocument()
  })

  it('switches to a full-screen timeline and back, keeping Speichern at hand (docs/14)', async () => {
    stubViewport(desktop)
    await renderLoaded()
    fireEvent.click(tab('Timeline'))
    expect(screen.getByLabelText('Timeline', { selector: ':not([role=tab])' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'ChordPro-Text' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
    fireEvent.click(tab('Text'))
    expect(screen.getByRole('textbox', { name: 'ChordPro-Text' })).toBeInTheDocument()
  })
})

describe('SheetEditor - preview and text find each other (#607, #617)', () => {
  const twoChoruses = '{part: Chorus}\n[C]Take my [G]hand\n{part: Chorus}\n[C]Take my [G]hand'

  it('phone: Vorschau marks the cursor\'s line; a tap there returns to Text at exactly that line, also when its text appears twice', async () => {
    stubViewport(phone)
    const textarea = await renderLoaded(song, twoChoruses)
    textarea.setSelectionRange(twoChoruses.length, twoChoruses.length)
    fireEvent.select(textarea)
    fireEvent.click(tab('Vorschau'))

    const lines = document.querySelectorAll<HTMLElement>('[data-source-line]')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toHaveAttribute('data-active-line', 'true')
    expect(lines[0]).not.toHaveAttribute('data-active-line')

    await act(async () => fireEvent.click(lines[0]))
    const back = screen.getByRole('textbox', { name: 'ChordPro-Text' }) as HTMLTextAreaElement
    expect(tab('Text')).toHaveAttribute('aria-selected', 'true')
    expect(back).toHaveFocus()
    expect(back.selectionStart).toBe(twoChoruses.indexOf('[C]Take'))
  })

  it('wide screen: the preview beside the text follows the cursor', async () => {
    stubViewport(desktop)
    const textarea = await renderLoaded(song, twoChoruses)
    const lines = () => document.querySelectorAll<HTMLElement>('[data-source-line]')
    textarea.setSelectionRange(0, 0)
    fireEvent.select(textarea)
    expect(lines()[0]).toHaveAttribute('data-active-line', 'true')
    textarea.setSelectionRange(twoChoruses.length, twoChoruses.length)
    fireEvent.select(textarea)
    expect(lines()[1]).toHaveAttribute('data-active-line', 'true')

    await act(async () => fireEvent.click(lines()[0]))
    expect(textarea).toHaveFocus()
    expect(textarea.selectionStart).toBe(twoChoruses.indexOf('[C]Take'))
  })
})

describe('SheetEditor - song switching moved to LibraryView', () => {
  it('has no Song dropdown, no "+ Neuer Song", and no "Song löschen" - only "← Bibliothek"', async () => {
    stubViewport(desktop)
    await renderLoaded()
    expect(screen.queryByLabelText('Song')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Neuer Song' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Song löschen' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Bibliothek' }).length).toBeGreaterThan(0)
  })
})

describe('SheetEditor - song not in the store yet when the editor opens', () => {
  // LibraryView's "+ Neu" saves the song to PouchDB and opens the editor right away; the songs
  // store only picks the new song up a moment later (change feed -> refreshSongs). The editor
  // must load it once it arrives instead of staying on "Lade…" forever.
  it('loads the song as soon as it reaches the store', async () => {
    stubViewport(phone)
    useSongsStore.setState({ songs: [] })
    render(<SheetEditor songId={song.id} variantId={null} onBack={vi.fn()} />)
    expect(screen.getByText('Lade…')).toBeInTheDocument()

    act(() => useSongsStore.setState({ songs: [song] }))

    expect(await screen.findByRole('textbox', { name: 'ChordPro-Text' })).toBeInTheDocument()
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

describe('SheetEditor - ChordPro keys above the phone keyboard (#606)', () => {
  /** The on-screen keyboard is up: the visible area is a small part of the screen. */
  const keyboardUp = () =>
    vi.stubGlobal('visualViewport', { offsetTop: 0, height: 100, addEventListener: () => {}, removeEventListener: () => {} })

  async function focusText(content = '[Am]Hello [C]world [Am]again') {
    const textarea = await renderLoaded(song, content)
    fireEvent.focus(textarea)
    return textarea
  }

  it('touchscreen + keyboard up: [ ] / | and the song\'s chords, most used first; a key types at the caret', async () => {
    stubViewport({ ...phone, coarse: true })
    keyboardUp()
    const textarea = await focusText()
    const bar = screen.getByRole('toolbar', { name: 'ChordPro-Tasten' })
    expect([...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['[', ']', '/', '|', '[Am] einfügen', '[C] einfügen', 'Einfügen'])

    textarea.setSelectionRange(0, 0)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '|' })))
    expect(textarea.value).toBe('|[Am]Hello [C]world [Am]again')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '[C] einfügen' })))
    expect(textarea.value.startsWith('|[C][Am]Hello')).toBe(true)
  })

  it('[ with text selected wraps it as a chord: "Am" → "[Am]"', async () => {
    stubViewport({ ...phone, coarse: true })
    keyboardUp()
    const textarea = await focusText('Am Hello')
    textarea.setSelectionRange(0, 2)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '[' })))
    expect(textarea.value).toBe('[Am] Hello')
    expect(textarea.selectionStart).toBe(4)
  })

  it('no bar without a touchscreen', async () => {
    stubViewport(phone)
    keyboardUp()
    await focusText()
    expect(screen.queryByRole('toolbar', { name: 'ChordPro-Tasten' })).not.toBeInTheDocument()
  })

  it('keyboard down on a touchscreen: no bar', async () => {
    stubViewport({ ...phone, coarse: true })
    vi.stubGlobal('visualViewport', { offsetTop: 0, height: window.screen.height, addEventListener: () => {}, removeEventListener: () => {} })
    await focusText()
    expect(screen.queryByRole('toolbar', { name: 'ChordPro-Tasten' })).not.toBeInTheDocument()
  })
})

describe('SheetEditor - text tools (#605)', () => {
  async function runTool(name: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Song-Editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Textwerkzeuge …' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name })))
  }

  it('Aufräumen on the whole text, then Rückgängig brings the text back', async () => {
    stubViewport(phone)
    const textarea = await renderLoaded(song, '[am]Hello  \n\n\n\nWorld')
    await runTool('Aufräumen …')
    // The rules dialog (2026-10-29): the defaults, how many places, then apply.
    expect(screen.getByRole('dialog', { name: 'Aufräumen' })).toHaveTextContent('der ganze Text')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Aufräumen \(\d+ Stellen\)$/ })))
    expect(textarea.value).toBe('[Am]Hello\n\nWorld')
    fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }))
    expect(textarea.value).toBe('[am]Hello  \n\n\n\nWorld')
  })

  it('a selection limits a tool to its lines: only the selected chord line is merged', async () => {
    stubViewport(phone)
    const text = 'G     D\nHello World\nC     F\nSecond line'
    const textarea = await renderLoaded(song, text)
    textarea.setSelectionRange(0, 3)
    // The chord line alone is selected - its lyric line below is not, so it stays a chord line.
    await runTool('Akkordzeilen integrieren')
    expect(textarea.value).toBe('[G]     [D]\nHello World\nC     F\nSecond line')
  })

  it('Suchen & Ersetzen is a bar over the text (like Notepad++): regex with a group, marked in the text, only the marked lines, Ersetzen one by one', async () => {
    stubViewport(phone)
    const textarea = await renderLoaded(song, '[Am]  la\n[G]   lu\n[C]  li')
    textarea.setSelectionRange(0, 12)
    await runTool('Suchen & Ersetzen …')
    const bar = screen.getByRole('region', { name: 'Suchen & Ersetzen' })
    fireEvent.click(within(bar).getByRole('radio', { name: 'Regex' }))
    fireEvent.change(within(bar).getByRole('textbox', { name: 'Suchen' }), { target: { value: '^\\[(\\w+)\\]\\s+' } })
    fireEvent.change(within(bar).getByRole('textbox', { name: 'Ersetzen durch' }), { target: { value: '[$1]' } })
    // Only the two marked lines count; the matches are drawn on the layer behind the text.
    expect(within(bar).getByText('1/2')).toBeInTheDocument()
    expect(screen.getByTestId('editor-backdrop').querySelectorAll('mark')).toHaveLength(2)
    await act(async () => fireEvent.click(within(bar).getByRole('button', { name: 'Ersetzen' })))
    expect(textarea.value).toBe('[Am]la\n[G]   lu\n[C]  li')
    await act(async () => fireEvent.click(within(bar).getByRole('button', { name: 'Alle ersetzen (1)' })))
    expect(textarea.value).toBe('[Am]la\n[G]lu\n[C]  li')
  })

  it('little room (keyboard up, a phone): the search is one row - ⇄ shows the replacement, ⚙ the options - and the variant row steps aside (2026-10-29)', async () => {
    stubViewport(phone)
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(420)
    try {
      await renderLoaded(song, '[Am]la\n[G]lu')
      await runTool('Suchen & Ersetzen …')
      const bar = screen.getByRole('region', { name: 'Suchen & Ersetzen' })
      expect(screen.queryByRole('combobox', { name: 'Variante' })).not.toBeInTheDocument()
      expect(within(bar).queryByRole('textbox', { name: 'Ersetzen durch' })).not.toBeInTheDocument()
      expect(within(bar).queryByRole('radiogroup', { name: 'Suchmodus' })).not.toBeInTheDocument()
      fireEvent.click(within(bar).getByRole('button', { name: 'Ersetzen anzeigen' }))
      expect(within(bar).getByRole('textbox', { name: 'Ersetzen durch' })).toBeInTheDocument()
      fireEvent.click(within(bar).getByRole('button', { name: 'Suchoptionen' }))
      expect(screen.getByRole('dialog', { name: 'Suchoptionen' })).toContainElement(screen.getByRole('radiogroup', { name: 'Suchmodus' }))
    } finally {
      height.mockRestore()
    }
  })

  it('shows invisible characters on the layer behind the text - · → ¶ - from the page menu', async () => {
    stubViewport(phone)
    await renderLoaded(song, 'a b\tc\nd')
    fireEvent.click(screen.getByRole('button', { name: 'Menü: Song-Editor' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Unsichtbare Zeichen einblenden/ })))
    expect(screen.getByTestId('editor-backdrop').textContent).toContain('·')
    expect(screen.getByTestId('editor-backdrop').textContent).toContain('→')
    expect(screen.getByTestId('editor-backdrop').textContent).toContain('¶')
    localStorage.clear()
  })

  it('names an unclosed bracket with its line once typing has paused', async () => {
    stubViewport(phone)
    await renderLoaded(song, '[G]fine\n[Am wrong')
    expect(await screen.findByText('Zeile 2: „[“ nicht geschlossen', undefined, { timeout: 2000 })).toBeInTheDocument()
  })
})

describe('SheetEditor - a text fix for the other variants on save (#600)', () => {
  it('offers the changed line to the variant that has it, nothing ticked; a ticked fix keeps that variant\'s timing', async () => {
    stubViewport({ orientation: 'landscape' })
    const { useSongVariantsStore } = await import('../store/useSongVariantsStore')
    const saveVariant = vi.fn(async () => {})
    const live = { ...variant, id: 'live', label: 'Live', isDefault: false, chordProContent: '[Verse]\n[00:04.00] [C]Take my [G]hand' }
    useSongVariantsStore.setState({ saveVariant, variants: [variant, live] })
    const textarea = await renderLoaded()
    fireEvent.change(textarea, { target: { value: '[Verse]\n[C]Take my [G]hands' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Speichern' })))

    const row = screen.getByRole('checkbox', { name: /Live · Zeile 2/ })
    expect(row).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(row)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Speichern + 1 Änderung' })))
    expect(saveVariant).toHaveBeenCalledWith(expect.objectContaining({ id: 'variant-1', chordProContent: '[Verse]\n[C]Take my [G]hands' }))
    expect(saveVariant).toHaveBeenCalledWith(expect.objectContaining({ id: 'live', chordProContent: '[Verse]\n[00:04.00] [C]Take my [G]hands' }))
  })

  it('"Abbrechen" saves nothing, and with no other variant sharing the line there is no question', async () => {
    stubViewport({ orientation: 'landscape' })
    const { useSongVariantsStore } = await import('../store/useSongVariantsStore')
    const saveVariant = vi.fn(async () => {})
    const live = { ...variant, id: 'live', label: 'Live', isDefault: false, chordProContent: '[Verse]\n[C]Take my [G]hand' }
    useSongVariantsStore.setState({ saveVariant, variants: [variant, live] })
    const textarea = await renderLoaded()
    fireEvent.change(textarea, { target: { value: '[Verse]\n[C]Take my [G]hands' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Speichern' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' })))
    expect(saveVariant).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    act(() => useSongVariantsStore.setState({ variants: [variant, { ...live, chordProContent: 'ganz anders' }] }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Speichern' })))
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(saveVariant).toHaveBeenCalledTimes(1)
  })
})
