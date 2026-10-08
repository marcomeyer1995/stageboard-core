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
  // useShowElapsed (#457) reads the position the test put into the mocked useShowMode value.
  const useShowMode = vi.fn()
  const usePosition = () => (useShowMode() as { elapsedMs?: number | null } | undefined)?.elapsedMs ?? null
  return { useShowMode, useShowElapsed: (select: (ms: number | null) => unknown) => select(usePosition()) }
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
    expect(screen.getByText('Drop D')).toBeInTheDocument()
  })
})
