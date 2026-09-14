import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Setlist, SetlistEntry, Song } from 'shared-types'

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
const { useDialogStore } = await import('../store/useDialogStore')
const { SetlistDetail } = await import('./SetlistDetail')

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }
}

function entry(id: string, songId: string): SetlistEntry {
  return { id, songId, variantId: null, trackId: null }
}

const setlist: Setlist = {
  id: 'sl-1',
  name: 'Herbst-Tour 2026',
  entries: [entry('e1', 'a'), entry('e2', 'b')],
  createdAt: 1000,
}

beforeEach(() => {
  useSongsStore.setState({ songs: [song('a', 'Alpha'), song('b', 'Bravo')] })
  useSetlistsStore.setState({ setlists: [setlist] })
})

describe('SetlistDetail - row reorder/remove (#181)', () => {
  it('has no up/down arrow buttons on a row - drag plus its own ⋯ menu instead', () => {
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    expect(screen.queryByRole('button', { name: '↑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '↓' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '×' })).not.toBeInTheDocument()
  })

  it("a row's ⋯ menu moves it up, saving the reordered entries", async () => {
    const saveSetlist = vi.fn(async () => {})
    useSetlistsStore.setState({ saveSetlist })
    render(<SetlistDetail setlistId="sl-1" onSelectSong={vi.fn()} onDeleted={vi.fn()} />)

    const row = screen.getByText('2. Bravo').closest('li')!
    fireEvent.click(within(row).getByTitle('Menü öffnen'))
    fireEvent.click(await screen.findByRole('button', { name: 'Nach oben' }))

    expect(saveSetlist).toHaveBeenCalledWith(
      expect.objectContaining({ entries: [entry('e2', 'b'), entry('e1', 'a')] }),
    )
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
