import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))
const queue = vi.hoisted(() => ({ isMaster: true, activeSetlist: null as { id: string; name: string } | null }))
vi.mock('../lib/queue', () => ({ useQueue: () => queue }))

const { useSetlistsStore } = await import('../store/useSetlistsStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { GigSetlistPicker } = await import('./GigSetlistPicker')

const setActiveSetlist = vi.fn(async () => {})

beforeEach(() => {
  queue.isMaster = true
  queue.activeSetlist = null
  setActiveSetlist.mockClear()
  useSetlistsStore.setState({ setlists: [{ id: 'herbst', name: 'Herbst', entries: [], createdAt: 1 }] } as never)
  useShowStateStore.setState({ setActiveSetlist, state: { playbackStatus: 'stopped' } } as never)
})

describe('GigSetlistPicker (☰, Marco 2026-10-16)', () => {
  it('the master taps the row and picks from a small list', async () => {
    render(<GigSetlistPicker />)
    fireEvent.click(screen.getByRole('button', { name: /Setlist: keine/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Herbst' }))
    await waitFor(() => expect(setActiveSetlist).toHaveBeenCalledWith('herbst'))
  })

  it('locked while a song plays, like switching to Solo Üben', () => {
    useShowStateStore.setState({ state: { playbackStatus: 'playing' } } as never)
    render(<GigSetlistPicker />)
    expect(screen.getByRole('button', { name: /Setlist: keine/ })).toBeDisabled()
  })

  it('everyone else reads it in the same row, without a button', () => {
    queue.isMaster = false
    queue.activeSetlist = { id: 'herbst', name: 'Herbst' }
    render(<GigSetlistPicker />)
    expect(screen.getByText('Herbst')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
