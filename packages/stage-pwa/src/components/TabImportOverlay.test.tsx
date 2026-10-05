import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookup = vi.hoisted(() => ({
  searchLookup: vi.fn(async () => ({ status: 'ok' as const, data: [{ id: 'r1', title: 'Wonderwall', subtitle: 'Oasis · Chords' }] })),
  fetchLookupDetail: vi.fn(),
}))
vi.mock('../lib/lookupClient', () => lookup)

const { TabImportOverlay } = await import('./TabImportOverlay')

beforeEach(() => vi.clearAllMocks())

describe('TabImportOverlay - known title (Marco, 2026-10-05)', () => {
  it('prefills the search with a known title and searches at once', async () => {
    render(<TabImportOverlay onImport={vi.fn()} onClose={vi.fn()} initialQuery="Wonderwall Oasis" />)
    expect(screen.getByDisplayValue('Wonderwall Oasis')).toBeInTheDocument()
    await waitFor(() => expect(lookup.searchLookup).toHaveBeenCalledWith(expect.any(String), 'Wonderwall Oasis'))
    expect(await screen.findByText('Wonderwall')).toBeInTheDocument()
  })

  it('waits for the user without a title', () => {
    render(<TabImportOverlay onImport={vi.fn()} onClose={vi.fn()} initialQuery="  " />)
    expect(lookup.searchLookup).not.toHaveBeenCalled()
  })
})
