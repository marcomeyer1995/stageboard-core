import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Setlist, SetlistEntry, Song, SongVariant } from 'shared-types'
import { changeSetlistDraft } from '../lib/setlistDrafts'
import { hasUnsavedChanges } from '../lib/unsavedChanges'

// Every *Store.ts pulls in a real PouchDB at import time (createWorkspaceCollection et al.),
// unavailable under happy-dom - same stand-in as LibraryView.test.tsx/SheetEditor.test.tsx.
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

const { useSongsStore } = await import('../store/useSongsStore')
const { useSetlistsStore } = await import('../store/useSetlistsStore')
const { useSongVariantsStore } = await import('../store/useSongVariantsStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { SetlistDetail } = await import('./SetlistDetail')

function song(id: string, title: string, artist?: string): Song {
  return { id, title, artist, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }
}

function entry(id: string, songId: string): SetlistEntry {
  return { id, songId, variantId: null, trackId: null }
}

function variant(id: string, songId: string, label: string, isDefault: boolean): SongVariant {
  return {
    id,
    songId,
    label,
    isDefault,
    bpm: 120,
    timeSignature: '4/4',
    clickTrackEnabled: false,
    chordProContent: '',
    timecodes: [],
    tracks: [],
    cues: [],
    countInEnabled: false,
    countInBars: 1,
  }
}

const setlist: Setlist = {
  id: 'sl-1',
  name: 'Herbst-Tour 2026',
  entries: [entry('e1', 'a'), entry('e2', 'b')],
  createdAt: 1000,
}

/** Opens the setlist and presses "Bearbeiten" - it opens as a read-only preview. */
function renderEditing(onDeleted = vi.fn()) {
  const view = render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={onDeleted} />)
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))
  return view
}

beforeEach(() => {
  useSongsStore.setState({
    songs: [song('a', 'Alpha'), song('b', 'Bravo'), song('c', 'Creep', 'Radiohead')],
  })
  useSetlistsStore.setState({ setlists: [setlist] })
})

describe('SetlistDetail - row reorder/remove', () => {
  it('has no up/down arrow buttons, and no "Nach oben"/"Nach unten" in the row menu - drag is the only reorder gesture', async () => {
    renderEditing()

    expect(screen.queryByRole('button', { name: '↑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '↓' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '×' })).not.toBeInTheDocument()

    const row = screen.getByText('1. Alpha').closest('li')!
    fireEvent.click(within(row).getByTitle('Menü öffnen'))

    expect(await screen.findByRole('button', { name: 'Entfernen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nach oben' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nach unten' })).not.toBeInTheDocument()
  })

  it("a row's ⋯ menu removes it, saving the entries without it", async () => {
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    renderEditing()

    const row = screen.getByText('1. Alpha').closest('li')!
    fireEvent.click(within(row).getByTitle('Menü öffnen'))
    fireEvent.click(await screen.findByRole('button', { name: 'Entfernen' }))

    // Nothing is stored before "Speichern" (Marco, 2026-10-07).
    expect(saveSetlist).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(saveSetlist).toHaveBeenCalledWith(expect.objectContaining({ entries: [entry('e2', 'b')] })))
  })
})

describe('SetlistDetail - variant picker (portal, not a plain <select>)', () => {
  // A plain <select>'s open popup got clipped in half by this row's own scrolling <ul> on a
  // laptop (confirmed working on a tablet, which renders <select> as a completely separate
  // OS-level picker instead) - portal-rendered now, same escape-any-ancestor pattern the ⋯
  // menu already uses, so this exercises the picker as an ordinary button + portal menu.
  beforeEach(() => {
    useSongVariantsStore.setState({
      variants: [
        variant('v1', 'a', 'Original', true),
        variant('v2', 'a', 'Akustik', false),
      ],
    })
  })

  it('shows the selected variant\'s label on its trigger button, not a native <select>', () => {
    renderEditing()

    const row = screen.getByText('1. Alpha').closest('li')!
    expect(within(row).getByRole('button', { name: 'Original' })).toBeInTheDocument()
    expect(row.querySelector('select')).not.toBeInTheDocument()
  })

  it('opens a menu listing every variant, and picking one saves it onto the entry', async () => {
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    renderEditing()

    const row = screen.getByText('1. Alpha').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Original' }))

    expect(await screen.findByRole('button', { name: 'Akustik' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Akustik' }))
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(saveSetlist).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({ id: 'e1', variantId: 'v2' }), entry('e2', 'b')],
      }),
    ))
  })
})

describe('SetlistDetail - preview and editing (Marco, 2026-10-07: like a song)', () => {
  it('opens as a clean preview - numbered songs, gig date, no editing controls', () => {
    useSetlistsStore.setState({ setlists: [{ ...setlist, performanceDate: '2026-12-24', targetEndTime: '23:00' }] })
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    expect(screen.getByRole('heading', { name: /Herbst-Tour 2026/ })).toBeInTheDocument()
    expect(screen.getByText(/Auftritt .*24\.12\.2026/)).toBeInTheDocument()
    expect(screen.getByText('Ende 23:00')).toBeInTheDocument()
    expect(screen.getByText('2 Songs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aktivieren' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Songs durchsuchen…')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
  })

  it('the name is edited in the editor and stored with "Speichern" - back to the preview', async () => {
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    renderEditing()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Winter-Tour 2027' } })
    expect(saveSetlist).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(saveSetlist).toHaveBeenCalledWith(expect.objectContaining({ name: 'Winter-Tour 2027' })))
    expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument()
  })

  it('"Abbrechen" with changes asks - "Verwerfen" throws them away', async () => {
    const saveSetlist = vi.fn(async () => {})
    const askUnsaved = vi.fn(async () => 'discard' as const)
    useDialogStore.setState({ askUnsaved })
    useSetlistsStore.setState({ saveSetlist })
    renderEditing()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Verworfen' } })
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))

    await waitFor(() => expect(askUnsaved).toHaveBeenCalled())
    expect(await screen.findByRole('heading', { name: /Herbst-Tour 2026/ })).toBeInTheDocument()
    expect(saveSetlist).not.toHaveBeenCalled()
  })

  it('"Speichern" in that question stores the changes, "Weiter bearbeiten" keeps the editor', async () => {
    const saveSetlist = vi.fn(async () => {})
    const askUnsaved = vi.fn<() => Promise<'save' | 'discard' | null>>(async () => null)
    useDialogStore.setState({ askUnsaved })
    useSetlistsStore.setState({ saveSetlist })
    renderEditing()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Winter-Tour' } })

    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => expect(askUnsaved).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('Name')).toHaveValue('Winter-Tour')

    askUnsaved.mockResolvedValue('save')
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    await waitFor(() => expect(saveSetlist).toHaveBeenCalledWith(expect.objectContaining({ name: 'Winter-Tour' })))
  })

  it('a name saved with a trailing space leaves nothing unsaved behind (#430 review)', async () => {
    const saveSetlist = vi.fn(async (saved: Setlist) => useSetlistsStore.setState({ setlists: [saved] }))
    useSetlistsStore.setState({ saveSetlist })
    renderEditing()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Sommerfest ' } })
    expect(hasUnsavedChanges()).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(saveSetlist).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sommerfest' })))
    await waitFor(() => expect(hasUnsavedChanges()).toBe(false))
  })

  it('a song dropped on the setlist while editing goes into the draft, saved with it (#430 review)', async () => {
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    const addC = (current: Setlist) => ({ ...current, entries: [...current.entries, entry('e3', 'c')] })
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)
    expect(changeSetlistDraft('sl-1', addC)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Winter-Tour' } })
    let intoDraft = false
    act(() => {
      intoDraft = changeSetlistDraft('sl-1', addC)
    })
    expect(intoDraft).toBe(true)
    expect(saveSetlist).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() =>
      expect(saveSetlist).toHaveBeenCalledWith(expect.objectContaining({ name: 'Winter-Tour', entries: [entry('e1', 'a'), entry('e2', 'b'), entry('e3', 'c')] })),
    )
  })

  it('"Abbrechen" without changes goes straight back, no question', async () => {
    const askUnsaved = vi.fn(async () => 'discard' as const)
    useDialogStore.setState({ askUnsaved })
    renderEditing()
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(await screen.findByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument()
    expect(askUnsaved).not.toHaveBeenCalled()
  })
})

describe('SetlistDetail - preview ⋯ menu (#181)', () => {
  function headerMenuButton() {
    return within(screen.getByRole('button', { name: 'Bearbeiten' }).parentElement!).getByTitle('Menü öffnen')
  }

  it('Duplizieren creates a copy under the prompted name', async () => {
    const duplicateSetlist = vi.fn(async () => null)
    useDialogStore.setState({ promptText: async () => 'Herbst-Tour 2026 (Kopie)' })
    useSetlistsStore.setState({ duplicateSetlist })
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    fireEvent.click(headerMenuButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Duplizieren' }))

    await waitFor(() => expect(duplicateSetlist).toHaveBeenCalledWith(setlist, 'Herbst-Tour 2026 (Kopie)'))
  })

  it('Löschen removes the setlist and calls onDeleted, after confirming', async () => {
    const remove = vi.fn(async () => {})
    const onDeleted = vi.fn()
    useDialogStore.setState({ confirm: async () => true })
    useSetlistsStore.setState({ remove })
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={onDeleted} />)

    fireEvent.click(headerMenuButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Löschen' }))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('sl-1'))
    expect(onDeleted).toHaveBeenCalled()
  })
})

describe('SetlistDetail - "Song hinzufügen" search combobox', () => {
  it('focusing the input shows every song; typing narrows by title or artist', () => {
    renderEditing()

    fireEvent.focus(screen.getByPlaceholderText('Songs durchsuchen…'))
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bravo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Creep/ })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Songs durchsuchen…'), { target: { value: 'radio' } })
    expect(screen.getByRole('button', { name: /Creep/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bravo' })).not.toBeInTheDocument()
  })

  it('shows "Keine Songs gefunden." for a query matching nothing', () => {
    renderEditing()

    fireEvent.focus(screen.getByPlaceholderText('Songs durchsuchen…'))
    fireEvent.change(screen.getByPlaceholderText('Songs durchsuchen…'), { target: { value: 'zzz' } })

    expect(screen.getByText('Keine Songs gefunden.')).toBeInTheDocument()
  })

  it('picking a result adds it to the setlist and resets/closes the dropdown', async () => {
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    renderEditing()

    const input = screen.getByPlaceholderText('Songs durchsuchen…')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Creep' } })
    fireEvent.click(screen.getByRole('button', { name: /Creep/ }))

    // The dropdown is closed (its plain "Bravo" result is gone; the row reads "2. Bravo").
    expect(screen.queryByRole('button', { name: 'Bravo' })).not.toBeInTheDocument()
    expect(screen.getByText('3. Creep')).toBeInTheDocument()
    expect(input).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(saveSetlist).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [entry('e1', 'a'), entry('e2', 'b'), expect.objectContaining({ songId: 'c' })],
      }),
    ))
  })

  it('closes the dropdown on an outside click', () => {
    render(
      <div>
        <button type="button">outside</button>
        <SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }))

    fireEvent.focus(screen.getByPlaceholderText('Songs durchsuchen…'))
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument()
  })
})
