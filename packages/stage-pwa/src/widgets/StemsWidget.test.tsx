import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SongVariant, TrackMeta } from 'shared-types'
import { StemsWidget } from './StemsWidget'
import { useShowMode } from '../lib/showMode'
import { __resetStemMixForTests, useStemMixStore } from '../lib/stemMix'

vi.mock('../lib/showMode', () => {
  const useShowMode = vi.fn()
  // Widgets read the clock only where they show it (#457) - the same mocked show for every hook.
  const withClock = () => ({ ...useShowMode(), elapsedNow: () => useShowMode()?.elapsedMs ?? null })
  return { useShowMode, useShowModeCore: withClock, useShowModeOnDemand: () => useShowMode() }
})

const track = (id: string, label: string, extra: Partial<TrackMeta> = {}): TrackMeta => ({
  id,
  kind: 'stem',
  label,
  source: 'stem-separation',
  parentTrackId: 'mix',
  mimeType: 'audio/mpeg',
  addedAt: 0,
  ...extra,
})
const VARIANT = {
  id: 'v1',
  tracks: [
    track('mix', 'Band', {
      kind: 'band-mix',
      parentTrackId: null,
      source: 'upload',
    }),
    track('drums', 'Schlagzeug', { role: 'drums' }),
    track('guitar', 'Gitarre', { role: 'guitar' }),
  ],
} as unknown as SongVariant

function mockMode(mode: 'gig' | 'practice', variant: SongVariant | null = VARIANT) {
  vi.mocked(useShowMode).mockReturnValue({
    mode,
    queue: { currentEntry: null, currentVariant: variant },
    trackOverride: null,
  } as unknown as ReturnType<typeof useShowMode>)
}

beforeEach(() => {
  localStorage.clear()
  __resetStemMixForTests()
})

describe('StemsWidget (docs/22 §3)', () => {
  it('shows a slider, Stumm and Solo per stem and stores them per song', () => {
    mockMode('practice')
    render(<StemsWidget config={{}} />)
    expect(screen.getByRole('slider', { name: 'Schlagzeug (Schlagzeug)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Spuren statt Track' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Stumm' })[1]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Solo' })[0]!)
    fireEvent.change(screen.getByRole('slider', { name: 'Schlagzeug (Schlagzeug)' }), { target: { value: '60' } })
    expect(useStemMixStore.getState().byVariant.v1).toEqual({
      on: true,
      set: null,
      stems: {
        guitar: { level: 1, muted: true, solo: false },
        drums: { level: 0.6, muted: false, solo: true },
      },
    })
  })

  it('says that stems play only in Solo practice', () => {
    mockMode('gig')
    useStemMixStore.getState().setOn('v1', true)
    render(<StemsWidget config={{}} />)
    expect(screen.getByText(/nur in Solo üben/)).toBeInTheDocument()
  })

  it('points to the song editor when a song has no stems', () => {
    mockMode('practice', { ...VARIANT, tracks: VARIANT.tracks.slice(0, 1) })
    render(<StemsWidget config={{}} />)
    expect(screen.getByText(/keine Spuren/)).toBeInTheDocument()
  })
})
