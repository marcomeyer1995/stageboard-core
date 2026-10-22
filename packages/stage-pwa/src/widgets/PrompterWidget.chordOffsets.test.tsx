import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song, SongVariant } from 'shared-types'
import { PrompterWidget } from './PrompterWidget'
import { useShowMode } from '../lib/showMode'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useChordOffsetStore } from '../store/useChordOffsetStore'
import { useProfilesStore } from '../store/useProfilesStore'
import type { PrompterConfig } from './prompterConfig'

// Same mocking reasoning as PrompterWidget.test.tsx.
vi.mock('../lib/showMode', () => {
  const show = vi.fn()
  // Widgets read the clock only where they show it (#457) - the same mocked show for every hook.
  return { useShowMode: show, useShowModeCore: () => ({ ...show(), elapsedNow: () => show()?.elapsedMs ?? null }), useShowModeOnDemand: show }
})
vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: vi.fn() }))
vi.mock('../store/useProfilesStore', () => ({ useProfilesStore: vi.fn() }))

const config: PrompterConfig = { viewMode: 'scroll' }

const SONG: Song = {
  id: 'song-1',
  title: 'Test Song',
  bpm: 120,
  timeSignature: '4/4',
  clickTrackEnabled: false,
  chordProContent: '[G]Hello [C]world',
  timecodes: [],
}

function mockShowMode(entryId: string, variant: Partial<SongVariant>) {
  vi.mocked(useShowMode).mockReturnValue({
    mode: 'gig',
    queue: {
      currentSong: SONG,
      currentEntry: { id: entryId, songId: SONG.id, variantId: null, trackId: null },
      currentVariant: { chordProContent: SONG.chordProContent, ...variant },
      currentArrangement: { chordProContent: SONG.chordProContent, ...variant },
    },
    elapsedMs: 0,
    playbackStatus: 'stopped',
  } as never)
}

// Transpose/capo sit behind the "Tonart" button (#410): open, step, close again.
const step = (label: string, times = 1) => {
  fireEvent.click(screen.getByRole('button', { name: /^Tonart/ }))
  for (let i = 0; i < times; i++) fireEvent.click(screen.getByLabelText(label))
  fireEvent.click(screen.getByRole('button', { name: 'Fertig' }))
}

describe('PrompterWidget - transpose and capo (#59)', () => {
  beforeEach(() => {
    useChordOffsetStore.getState().reset()
    vi.mocked(useActiveProfile).mockReturnValue(undefined)
    vi.mocked(useProfilesStore).mockImplementation(((selector: (state: { profiles: never[] }) => unknown) =>
      selector({ profiles: [] })) as never)
  })

  it('#410: no steppers above the lyrics - one "Tonart" button that shows what is changed', () => {
    mockShowMode('e1', { key: 'G' })
    render(<PrompterWidget config={config} />)
    expect(screen.queryByLabelText('Transpose erhöhen')).not.toBeInTheDocument()
    // The button shows the key; capo is a chip next to it.
    expect(screen.getByRole('button', { name: 'Tonart: G' })).toBeInTheDocument()
    step('Transpose erhöhen', 2)
    step('Capo erhöhen')
    expect(screen.getByRole('button', { name: 'Tonart: A (+2)' })).toBeInTheDocument()
    expect(screen.getByText('Capo 1')).toBeInTheDocument()
  })

  it('transposition only: chords shift and the sounding key follows', () => {
    mockShowMode('e1', { key: 'G' })
    render(<PrompterWidget config={config} />)

    step('Transpose verringern')

    expect(screen.getByText('Gb')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tonart: Gb (-1)' })).toBeInTheDocument()
  })

  it('capo only: chords shift down but the sounding key stays', () => {
    mockShowMode('e1', { key: 'G' })
    render(<PrompterWidget config={config} />)

    step('Capo erhöhen')

    expect(screen.getByText('Gb')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tonart: G' })).toBeInTheDocument()
    expect(screen.getByText('Capo 1')).toBeInTheDocument()
  })

  it('combined: +2 transpose with capo 2 reads as the written chords, sounding a tone higher', () => {
    mockShowMode('e1', { key: 'G' })
    render(<PrompterWidget config={config} />)

    step('Transpose erhöhen', 2)
    step('Capo erhöhen', 2)

    expect(screen.getByText('G')).toBeInTheDocument()
    expect(screen.getByText('C')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tonart: A (+2)' })).toBeInTheDocument()
  })

  it('resets when the queue moves to another entry', () => {
    mockShowMode('e1', { key: 'G' })
    const { rerender } = render(<PrompterWidget config={config} />)
    step('Transpose erhöhen', 2)
    expect(screen.getByText('A')).toBeInTheDocument()

    mockShowMode('e2', { key: 'G' })
    rerender(<PrompterWidget config={config} />)

    expect(screen.getByRole('button', { name: 'Tonart: G' })).toBeInTheDocument()
  })

  it('counts the authored capo: the written chords already assume it', () => {
    mockShowMode('e1', { key: 'G', capo: 2 })
    render(<PrompterWidget config={config} />)

    expect(screen.getByText('Capo 2')).toBeInTheDocument()
    step('Capo verringern', 3)
    // Cannot go below fret 0: authored 2 + offset -2 - and fret 0 needs no chip.
    expect(screen.queryByText(/^Capo \d/)).not.toBeInTheDocument()
  })

  it('still transposes chords for a song without a key, just without a sounding-key label', () => {
    mockShowMode('e1', {})
    render(<PrompterWidget config={config} />)

    step('Transpose erhöhen', 2)

    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tonart +2' })).toBeInTheDocument()
  })

  it('#410: standard tuning takes no room, another tuning gets a chip', () => {
    mockShowMode('e1', { key: 'G', tuning: 'E A D G B E' })
    const { rerender } = render(<PrompterWidget config={config} />)
    expect(screen.queryByText(/E A D G B E|Tuning/)).not.toBeInTheDocument()
    mockShowMode('e1', { key: 'G', tuning: 'Drop D' })
    rerender(<PrompterWidget config={config} />)
    // Old free text is read as what the chart is written for - a Drop D chart is played in Drop D.
    expect(screen.getByText('Stimmung Drop D')).toBeInTheDocument()
    mockShowMode('e1', { key: 'G', tuning: 'Nashville' })
    rerender(<PrompterWidget config={config} />)
    expect(screen.getByText('Nashville')).toBeInTheDocument()
  })
})

// Marco, 2026-10-18: transpose is how the variant sounds against the original; the tuning gives part of it.
describe('PrompterWidget - stored transpose and tuning', () => {
  beforeEach(() => {
    useChordOffsetStore.getState().reset()
    vi.mocked(useActiveProfile).mockReturnValue(undefined)
    vi.mocked(useProfilesStore).mockImplementation(((selector: (state: { profiles: never[] }) => unknown) =>
      selector({ profiles: [] })) as never)
  })

  it('shows the transposed chords and the sounding key for every player', () => {
    mockShowMode('e1', { key: 'G', transpose: -2 })
    render(<PrompterWidget config={config} />)
    expect(screen.getByText('F')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tonart: F' })).toBeInTheDocument()
  })

  it('a guitar tuned a half step down grabs the written chords for a song a half step lower', () => {
    mockShowMode('e1', { key: 'G', transpose: -1, tuningSpec: { semitones: -1 } })
    render(<PrompterWidget config={config} />)
    expect(screen.getByText('G')).toBeInTheDocument()
    expect(screen.getByText('Stimmung ½ Ton tiefer (Eb)')).toBeInTheDocument()
  })

  it('without a Stimmung the song is played in standard tuning', () => {
    mockShowMode('e1', { key: 'G', transpose: -2 })
    render(<PrompterWidget config={config} />)
    expect(screen.getByText('F')).toBeInTheDocument()
    expect(screen.queryByText(/Stimmung/)).not.toBeInTheDocument()
  })

  it('a chart written for Eb shows as written on a guitar in Eb sounding like the original, and Drop is a chip only', () => {
    mockShowMode('e1', { key: 'G', chartTuning: { semitones: -1 }, tuningSpec: { semitones: -1, drop: true } })
    render(<PrompterWidget config={config} />)
    expect(screen.getByText('G')).toBeInTheDocument()
    expect(screen.getByText('Stimmung Drop C#')).toBeInTheDocument()
  })
})
