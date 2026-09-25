import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SetlistEntry, SongVariant } from 'shared-types'
import { TrackOverrideWidget } from './TrackOverrideWidget'
import { useShowMode } from '../lib/showMode'

vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))

function track(id: string, kind: 'reference' | 'band-mix' | 'stem', label: string) {
  return { id, kind, label, source: 'upload', parentTrackId: null, mimeType: 'audio/mpeg', addedAt: 1 }
}

function mockQueue(tracks: ReturnType<typeof track>[], entryTrackId: string | null = null) {
  const variant = { id: 'v1', songId: 's1', label: 'Original', tracks } as unknown as SongVariant
  const entry: SetlistEntry = { id: 'e1', songId: 's1', variantId: 'v1', trackId: entryTrackId }
  vi.mocked(useShowMode).mockReturnValue({
    queue: { currentEntry: entry, currentVariant: variant },
    trackOverride: null,
    canControl: true,
    setTrackOverride: vi.fn(),
  } as unknown as ReturnType<typeof useShowMode>)
}

describe('TrackOverrideWidget', () => {
  it('labels the default option with the track that actually plays - the first band-mix', () => {
    mockQueue([track('ref', 'reference', 'YouTube Referenz'), track('mix', 'band-mix', 'Mix komplett'), track('mix2', 'band-mix', 'ohne Gitarre')])
    render(<TrackOverrideWidget config={{}} />)

    expect(screen.getByRole('option', { name: 'Automatisch (Mix komplett)' })).toBeInTheDocument()
    expect(screen.queryByText(/Standard \(Setlist\)/)).not.toBeInTheDocument()
  })

  it('falls back to the first track when there is no band-mix', () => {
    mockQueue([track('ref', 'reference', 'YouTube Referenz'), track('stem', 'stem', 'Drums')])
    render(<TrackOverrideWidget config={{}} />)

    expect(screen.getByRole('option', { name: 'Automatisch (YouTube Referenz)' })).toBeInTheDocument()
  })
})
