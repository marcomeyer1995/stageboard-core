import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetlistEntry, Song, SongVariant } from 'shared-types'
import { useShowMode } from '../lib/showMode'

vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))
// useSongVariantsStore's db module constructs a real PouchDB at load time - unavailable under
// happy-dom (same mock as the other component tests use).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
    changes() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { TrackOverrideWidget } = await import('./TrackOverrideWidget')
const { useSongVariantsStore } = await import('../store/useSongVariantsStore')

const SONG = { id: 's1', title: 'Song' } as Song

function track(id: string, kind: 'reference' | 'band-mix' | 'stem', label: string) {
  return { id, kind, label, source: 'upload', parentTrackId: null, mimeType: 'audio/mpeg', addedAt: 1 }
}

function variant(id: string, label: string, isDefault: boolean, tracks: ReturnType<typeof track>[]): SongVariant {
  return { id, songId: 's1', label, isDefault, tracks } as unknown as SongVariant
}

const ORIGINAL = variant('v-orig', 'Original', true, [track('mix', 'band-mix', 'Mix komplett'), track('mix2', 'band-mix', 'ohne Gitarre')])
const ACOUSTIC = variant('v-acoustic', 'Akustik', false, [])

function mockMode(
  mode: 'gig' | 'practice',
  opts: { current?: SongVariant; variants?: SongVariant[]; setVariantOverride?: (id: string | null) => void } = {},
) {
  const current = opts.current ?? ORIGINAL
  useSongVariantsStore.setState({ variants: opts.variants ?? [current] })
  const entry: SetlistEntry = { id: 's1', songId: 's1', variantId: null, trackId: null }
  vi.mocked(useShowMode).mockReturnValue({
    mode,
    queue: { currentEntry: entry, currentSong: SONG, currentVariant: current },
    trackOverride: null,
    canControl: true,
    setTrackOverride: vi.fn(),
    variantOverride: null,
    setVariantOverride: mode === 'practice' ? (opts.setVariantOverride ?? vi.fn()) : null,
  } as unknown as ReturnType<typeof useShowMode>)
}

beforeEach(() => {
  useSongVariantsStore.setState({ variants: [] })
})

describe('TrackOverrideWidget - track', () => {
  it('labels the default option with the track that actually plays - the first band-mix', () => {
    mockMode('gig', {
      current: variant('v1', 'Original', true, [
        track('ref', 'reference', 'YouTube Referenz'),
        track('mix', 'band-mix', 'Mix komplett'),
        track('mix2', 'band-mix', 'ohne Gitarre'),
      ]),
    })
    render(<TrackOverrideWidget config={{}} />)

    expect(screen.getByRole('option', { name: 'Automatisch (Mix komplett)' })).toBeInTheDocument()
    expect(screen.queryByText(/Standard \(Setlist\)/)).not.toBeInTheDocument()
  })

  it('falls back to the first track when there is no band-mix', () => {
    mockMode('gig', {
      current: variant('v1', 'Original', true, [track('ref', 'reference', 'YouTube Referenz'), track('stem', 'stem', 'Drums')]),
    })
    render(<TrackOverrideWidget config={{}} />)

    expect(screen.getByRole('option', { name: 'Automatisch (YouTube Referenz)' })).toBeInTheDocument()
  })
})

describe('TrackOverrideWidget - variant (Practice mode)', () => {
  it('offers the song\'s variants in Practice mode, the default option naming the entry\'s own variant', () => {
    const setVariantOverride = vi.fn()
    mockMode('practice', { variants: [ORIGINAL, ACOUSTIC], setVariantOverride })
    render(<TrackOverrideWidget config={{}} />)

    const select = screen.getByLabelText('Variante')
    expect(screen.getByRole('option', { name: 'Automatisch (Original)' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Akustik' })).toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'v-acoustic' } })
    expect(setVariantOverride).toHaveBeenCalledWith('v-acoustic')

    fireEvent.change(select, { target: { value: '' } })
    expect(setVariantOverride).toHaveBeenLastCalledWith(null)
  })

  it('never offers a variant picker in Gig mode - the setlist decides there, band-wide', () => {
    mockMode('gig', { variants: [ORIGINAL, ACOUSTIC] })
    render(<TrackOverrideWidget config={{}} />)

    expect(screen.queryByLabelText('Variante')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Track')).toBeInTheDocument()
  })

  it('hides the picker when the song has only one variant', () => {
    mockMode('practice', { variants: [ORIGINAL] })
    render(<TrackOverrideWidget config={{}} />)

    expect(screen.queryByLabelText('Variante')).not.toBeInTheDocument()
  })

  it('keeps the variant picker even when the chosen variant has no tracks, so you can switch back', () => {
    mockMode('practice', { current: ACOUSTIC, variants: [ORIGINAL, ACOUSTIC] })
    render(<TrackOverrideWidget config={{}} />)

    expect(screen.getByLabelText('Variante')).toBeInTheDocument()
    expect(screen.getByText('Kein Track angehängt')).toBeInTheDocument()
    expect(screen.queryByLabelText('Track')).not.toBeInTheDocument()
  })
})
