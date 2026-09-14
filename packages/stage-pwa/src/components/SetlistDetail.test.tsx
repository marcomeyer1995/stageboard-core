import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Setlist, SetlistEntry, Song, SongVariant } from 'shared-types'

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
    beatAnchors: [],
    tempoMarkers: [],
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

beforeEach(() => {
  useSongsStore.setState({
    songs: [song('a', 'Alpha'), song('b', 'Bravo'), song('c', 'Creep', 'Radiohead')],
  })
  useSetlistsStore.setState({ setlists: [setlist] })
})

describe('SetlistDetail - row reorder/remove', () => {
  it('has no up/down arrow buttons, and no "Nach oben"/"Nach unten" in the row menu - drag is the only reorder gesture', async () => {
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

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
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    const row = screen.getByText('1. Alpha').closest('li')!
    fireEvent.click(within(row).getByTitle('Menü öffnen'))
    fireEvent.click(await screen.findByRole('button', { name: 'Entfernen' }))

    expect(saveSetlist).toHaveBeenCalledWith(expect.objectContaining({ entries: [entry('e2', 'b')] }))
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
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    const row = screen.getByText('1. Alpha').closest('li')!
    expect(within(row).getByRole('button', { name: 'Original' })).toBeInTheDocument()
    expect(row.querySelector('select')).not.toBeInTheDocument()
  })

  it('opens a menu listing every variant, and picking one saves it onto the entry', async () => {
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    const row = screen.getByText('1. Alpha').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'Original' }))

    expect(await screen.findByRole('button', { name: 'Akustik' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Akustik' }))

    expect(saveSetlist).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [expect.objectContaining({ id: 'e1', variantId: 'v2' }), entry('e2', 'b')],
      }),
    )
  })
})

describe('SetlistDetail - header ⋯ menu (#181)', () => {
  function headerMenuButton() {
    const headerRow = screen.getByRole('heading', { name: /Herbst-Tour 2026/ }).closest('div')!
    return within(headerRow).getByTitle('Menü öffnen')
  }

  it('Umbenennen renames the setlist', async () => {
    const saveSetlist = vi.fn(async () => {})
    useDialogStore.setState({ promptText: async () => 'Winter-Tour 2027' })
    useSetlistsStore.setState({ saveSetlist })
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    fireEvent.click(headerMenuButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Umbenennen' }))

    // handleRename is async (awaits the mocked promptText first) - the click above only starts it.
    await waitFor(() => expect(saveSetlist).toHaveBeenCalledWith(expect.objectContaining({ name: 'Winter-Tour 2027' })))
  })

  it('Duplizieren creates a copy under the prompted name', async () => {
    const duplicateSetlist = vi.fn(async () => null)
    useDialogStore.setState({ promptText: async () => 'Herbst-Tour 2026 (Kopie)' })
    useSetlistsStore.setState({ duplicateSetlist })
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    fireEvent.click(headerMenuButton())
    fireEvent.click(await screen.findByRole('button', { name: 'Duplizieren' }))

    await waitFor(() => expect(duplicateSetlist).toHaveBeenCalledWith('sl-1', 'Herbst-Tour 2026 (Kopie)'))
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
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

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
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    fireEvent.focus(screen.getByPlaceholderText('Songs durchsuchen…'))
    fireEvent.change(screen.getByPlaceholderText('Songs durchsuchen…'), { target: { value: 'zzz' } })

    expect(screen.getByText('Keine Songs gefunden.')).toBeInTheDocument()
  })

  it('picking a result adds it to the setlist and resets/closes the dropdown', () => {
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    const input = screen.getByPlaceholderText('Songs durchsuchen…')
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Creep' } })
    fireEvent.click(screen.getByRole('button', { name: /Creep/ }))

    expect(saveSetlist).toHaveBeenCalledWith(
      expect.objectContaining({
        entries: [entry('e1', 'a'), entry('e2', 'b'), expect.objectContaining({ songId: 'c' })],
      }),
    )
    expect(screen.queryByRole('button', { name: /Creep/ })).not.toBeInTheDocument()
    expect(input).toHaveValue('')
  })

  it('closes the dropdown on an outside click', () => {
    render(
      <div>
        <button type="button">outside</button>
        <SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />
      </div>,
    )

    fireEvent.focus(screen.getByPlaceholderText('Songs durchsuchen…'))
    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }))
    expect(screen.queryByRole('button', { name: 'Alpha' })).not.toBeInTheDocument()
  })
})
