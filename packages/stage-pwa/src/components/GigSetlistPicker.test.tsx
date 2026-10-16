import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))
const queue = vi.hoisted(() => ({ isMaster: true, activeSetlist: null as { id: string } | null }))
vi.mock('../lib/queue', () => ({ useQueue: () => queue }))

const { useSetlistsStore } = await import('../store/useSetlistsStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { useDialogStore } = await import('../store/useDialogStore')
const { GigSetlistPicker } = await import('./GigSetlistPicker')

const setActiveSetlist = vi.fn(async () => {})
const confirm = vi.fn()

beforeEach(() => {
  queue.isMaster = true
  setActiveSetlist.mockClear()
  confirm.mockReset().mockResolvedValue(false)
  useSetlistsStore.setState({ setlists: [{ id: 'herbst', name: 'Herbst', entries: [], createdAt: 1 }] } as never)
  useShowStateStore.setState({ setActiveSetlist, state: { playbackStatus: 'stopped' } } as never)
  useDialogStore.setState({ confirm } as never)
})

describe('GigSetlistPicker (☰, Marco 2026-10-16)', () => {
  it('the master sets the active setlist; others see nothing', async () => {
    const { unmount } = render(<GigSetlistPicker />)
    fireEvent.change(screen.getByLabelText('Aktive Setlist'), { target: { value: 'herbst' } })
    await waitFor(() => expect(setActiveSetlist).toHaveBeenCalledWith('herbst'))
    expect(confirm).not.toHaveBeenCalled()
    unmount()
    queue.isMaster = false
    render(<GigSetlistPicker />)
    expect(screen.queryByLabelText('Aktive Setlist')).not.toBeInTheDocument()
  })

  it('while the show plays it asks first', async () => {
    useShowStateStore.setState({ state: { playbackStatus: 'playing' } } as never)
    render(<GigSetlistPicker />)
    fireEvent.change(screen.getByLabelText('Aktive Setlist'), { target: { value: 'herbst' } })
    await waitFor(() => expect(confirm).toHaveBeenCalled())
    expect(setActiveSetlist).not.toHaveBeenCalled()
  })
})
