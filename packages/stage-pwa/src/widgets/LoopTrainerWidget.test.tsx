import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song, SongVariant } from 'shared-types'
import { LoopTrainerWidget } from './LoopTrainerWidget'
import { useShowMode } from '../lib/showMode'
import { useLoopTrainerStore } from '../store/useLoopTrainerStore'

// Same mocking reasoning as PrompterWidget.test.tsx; the audio start/stop itself is the engine's job.
vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))
vi.mock('../lib/loopTrainer', () => ({ startLoopTrainer: vi.fn(), stopLoopTrainer: vi.fn() }))
vi.mock('../store/usePracticeStateStore', () => ({
  DEFAULT_PRACTICE_STATE: { trackOverride: null },
  usePracticeStateStore: (selector: (state: { byWorkspace: Record<string, unknown> }) => unknown) => selector({ byWorkspace: {} }),
}))
vi.mock('../store/useWorkspaceStore', () => ({
  useWorkspaceStore: (selector: (state: { activeWorkspaceId: string }) => unknown) => selector({ activeWorkspaceId: 'band' }),
}))

const SONG: Song = {
  id: 's1',
  title: 'Test',
  bpm: 120,
  timeSignature: '4/4',
  clickTrackEnabled: false,
  chordProContent: '',
  timecodes: [],
}

const VARIANT = {
  id: 'v1',
  songId: 's1',
  chordProContent: '{part: Verse}\n[00:10.00]la\n{part: Chorus}\n[00:40.00]la',
  tracks: [{ id: 't1', kind: 'band-mix', label: 'Mix', parentTrackId: null, durationMs: 90_000 }],
} as unknown as SongVariant

function mockMode(mode: 'gig' | 'practice', elapsedMs: number | null = 12_500, variant: SongVariant | null = VARIANT) {
  vi.mocked(useShowMode).mockReturnValue({
    mode,
    queue: {
      currentSong: SONG,
      currentVariant: variant,
      currentEntry: { id: 'e1', songId: 's1', variantId: null, trackId: null },
    },
    elapsedMs,
  } as never)
}

describe('LoopTrainerWidget (#61)', () => {
  beforeEach(() => {
    useLoopTrainerStore.setState({ entryId: null, active: false, error: null })
  })

  it('explains itself away in Gig mode instead of offering a control that would desync the band', () => {
    mockMode('gig')
    render(<LoopTrainerWidget config={{}} />)
    expect(screen.getByText('Nur in Solo Üben verfügbar')).toBeInTheDocument()
    expect(screen.queryByText('Loop starten')).not.toBeInTheDocument()
  })

  it('says so when the song has no track', () => {
    mockMode('practice', 12_500, { ...VARIANT, tracks: [] } as SongVariant)
    render(<LoopTrainerWidget config={{}} />)
    expect(screen.getByText('Kein Track angehängt')).toBeInTheDocument()
  })

  it('cannot start before both loop points are set', () => {
    mockMode('practice')
    render(<LoopTrainerWidget config={{}} />)
    expect(screen.getByText('Loop starten')).toBeDisabled()
  })

  it('takes A and B from the current position and then allows starting', () => {
    mockMode('practice', 12_500)
    const { rerender } = render(<LoopTrainerWidget config={{}} />)
    fireEvent.click(screen.getByText('A setzen'))

    mockMode('practice', 27_000)
    rerender(<LoopTrainerWidget config={{}} />)
    fireEvent.click(screen.getByText('B setzen'))

    expect(screen.getByText('0:12.5')).toBeInTheDocument()
    expect(screen.getByText('0:27.0')).toBeInTheDocument()
    expect(screen.getByText('Loop starten')).toBeEnabled()
  })

  it('snaps the loop to song sections', () => {
    mockMode('practice')
    render(<LoopTrainerWidget config={{}} />)
    fireEvent.change(screen.getByLabelText('Von Abschnitt'), { target: { value: '10000' } })
    fireEvent.change(screen.getByLabelText('Bis Ende von'), { target: { value: '90000' } })

    expect(useLoopTrainerStore.getState().config).toMatchObject({ startMs: 10_000, endMs: 90_000 })
  })

  it('shows the trainer settings only once the Speed Trainer is switched on', () => {
    mockMode('practice')
    render(<LoopTrainerWidget config={{}} />)
    expect(screen.queryByText('Ziel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Speed Trainer'))
    expect(screen.getByText('Ziel')).toBeInTheDocument()
    expect(screen.getByText('Pro Durchgang +')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Tempo verringern'))
    expect(useLoopTrainerStore.getState().config.startPercent).toBe(95)
  })
})
