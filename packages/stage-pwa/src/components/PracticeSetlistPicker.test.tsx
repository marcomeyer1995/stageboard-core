import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))
const practice = vi.hoisted(() => ({ set: vi.fn() }))
vi.mock('../lib/practiceQueue', () => ({ usePracticeQueue: () => ({ activeSetlist: null }), practiceSetActiveSetlist: practice.set }))

const { useSetlistsStore } = await import('../store/useSetlistsStore')
const { PracticeSetlistPicker } = await import('./PracticeSetlistPicker')

describe('PracticeSetlistPicker (Marco, 2026-10-16: like Gig, no dropdown)', () => {
  it('a row that opens the pick list; the whole catalog is the "none" choice', () => {
    useSetlistsStore.setState({ setlists: [{ id: 'herbst', name: 'Herbst', entries: [], createdAt: 1 }] } as never)
    render(<PracticeSetlistPicker />)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Setlist: keine/ }))
    expect(screen.getByRole('button', { name: 'Keine Setlist (ganzer Katalog)' })).toHaveAttribute('aria-current', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Herbst' }))
    expect(practice.set).toHaveBeenCalledWith('herbst')
  })
})
