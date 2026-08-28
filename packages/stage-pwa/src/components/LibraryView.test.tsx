import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const { useSongsStore } = await import('../store/useSongsStore')
const { useSetlistsStore } = await import('../store/useSetlistsStore')
const { LibraryView } = await import('./LibraryView')

function song(id: string, title: string): Song {
  return { id, title, bpm: 120, chordProContent: '', timecodes: [] }
}

function setlist(id: string, name: string, createdAt: number): Setlist {
  return { id, name, entries: [], createdAt }
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
})
