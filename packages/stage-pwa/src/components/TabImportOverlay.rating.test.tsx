import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/lookupClient', () => ({
  searchLookup: vi.fn(async () => ({
    status: 'ok' as const,
    data: [
      { id: 'a', title: 'Wonderwall', subtitle: 'Oasis · Chords', rating: 4.81, votes: 11313 },
      { id: 'b', title: 'Wonderwall', subtitle: 'Oasis · Tab' },
    ],
  })),
  fetchLookupDetail: vi.fn(),
}))

const { TabImportOverlay } = await import('./TabImportOverlay')

describe('TabImportOverlay - star rating (Marco, 2026-10-05)', () => {
  it('shows stars and votes next to a rated version, nothing for an unrated one', async () => {
    render(<TabImportOverlay onImport={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wonderwall' } })
    fireEvent.submit(screen.getByRole('textbox').closest('form')!)
    expect(await screen.findByLabelText('4,8 von 5 Sternen, 11.313 Bewertungen')).toBeInTheDocument()
    expect(screen.getAllByText(/Bewertungen/)).toHaveLength(1)
  })
})
