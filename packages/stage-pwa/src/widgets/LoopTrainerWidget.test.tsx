import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Song, SongVariant } from 'shared-types'
import { LoopTrainerWidget } from './LoopTrainerWidget'
import { useShowMode } from '../lib/showMode'
import { useLoopTrainerStore } from '../store/useLoopTrainerStore'
import { useSavedLoopsStore } from '../store/useSavedLoopsStore'
import { putSavedLoop, removeSavedLoop } from '../lib/savedLoopsDb'
import type { SavedLoop } from '../lib/savedLoops'

// Same mocking reasoning as PrompterWidget.test.tsx; the audio start/stop itself is the engine's job.
vi.mock('../lib/showMode', () => {
  const show = vi.fn()
  // Widgets read the clock only where they show it (#457) - the same mocked show for every hook.
  return { useShowMode: show, useShowModeCore: () => ({ ...show(), elapsedNow: () => show()?.elapsedMs ?? null }), useShowModeOnDemand: show }
})
vi.mock('../lib/loopTrainer', () => ({ startLoopTrainer: vi.fn(), stopLoopTrainer: vi.fn(), useTrainerLoop: () => null }))
vi.mock('../lib/savedLoopsDb', () => ({ putSavedLoop: vi.fn(async () => {}), removeSavedLoop: vi.fn(async () => {}) }))
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
    useLoopTrainerStore.setState({ entryId: null, error: null })
    useSavedLoopsStore.setState({ loops: [] })
    vi.mocked(putSavedLoop).mockClear()
    vi.mocked(removeSavedLoop).mockClear()
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

  it('puts A and B on the bars of the grid and moves them bar by bar (#683)', () => {
    // 120 BPM 4/4: a bar every 2 s, so 12.5 s lies in bar 7 (12-14 s).
    mockMode('practice', 12_500, { ...VARIANT, bpm: 120, timeSignature: '4/4' } as SongVariant)
    render(<LoopTrainerWidget config={{}} />)
    fireEvent.click(screen.getByText('A setzen'))
    expect(useLoopTrainerStore.getState().config.startMs).toBe(12_000)
    expect(screen.getByText('Takt 7')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('A erhöhen'))
    expect(useLoopTrainerStore.getState().config.startMs).toBe(14_000)

    fireEvent.click(screen.getByRole('radio', { name: 'Schläge' }))
    fireEvent.click(screen.getByLabelText('A verringern'))
    expect(useLoopTrainerStore.getState().config.startMs).toBe(13_500)
    expect(screen.getByText('Takt 7.4')).toBeInTheDocument()

    // Back to bars: the point moves onto the nearest bar at once.
    fireEvent.click(screen.getByRole('radio', { name: 'Takte' }))
    expect(useLoopTrainerStore.getState().config.startMs).toBe(14_000)
  })

  it('keeps B after A', () => {
    mockMode('practice', 12_500, { ...VARIANT, bpm: 120, timeSignature: '4/4' } as SongVariant)
    useLoopTrainerStore.getState().setConfig('e1', { startMs: 12_000, endMs: 14_000 })
    render(<LoopTrainerWidget config={{}} />)
    expect(screen.getByLabelText('B verringern')).toBeDisabled()
    expect(screen.getByLabelText('A erhöhen')).toBeDisabled()
  })

  it('keeps tempo and Speed Trainer in a dialog - the widget itself never scrolls (2026-10-22)', () => {
    mockMode('practice')
    render(<LoopTrainerWidget config={{}} />)
    expect(screen.queryByRole('switch', { name: 'Speed Trainer' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tempo 100 %' }))
    expect(screen.queryByText('Ziel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Speed Trainer' }))
    expect(screen.getByText('Ziel')).toBeInTheDocument()
    expect(screen.getByText('Pro Durchgang +')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Tempo verringern'))
    expect(useLoopTrainerStore.getState().config.startPercent).toBe(95)
    expect(screen.getByRole('button', { name: 'Tempo 95 → 100 %' })).toBeInTheDocument()
  })

  describe('saved loops (#683 step 3)', () => {
    const GRID_VARIANT = { ...VARIANT, bpm: 120, timeSignature: '4/4' } as SongVariant
    const SOLO: SavedLoop = { id: 'l1', variantId: 'v1', name: 'Solo', startMs: 20_000, endMs: 28_000, snap: 'bars', startPercent: 80, trainerEnabled: true, targetPercent: 100, stepPercent: 5 }

    it('saves the current setting under a name, for this variant', () => {
      mockMode('practice', 12_500, GRID_VARIANT)
      useLoopTrainerStore.getState().setConfig('e1', { startMs: 12_000, endMs: 16_000 })
      render(<LoopTrainerWidget config={{}} />)
      fireEvent.click(screen.getByRole('button', { name: 'Gespeicherte Loops' }))
      expect(screen.getByText('Für diese Variante ist noch kein Loop gespeichert.')).toBeInTheDocument()

      fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Intro ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Als neuen Loop speichern' }))
      expect(vi.mocked(putSavedLoop)).toHaveBeenCalledWith(expect.objectContaining({ variantId: 'v1', name: 'Intro', startMs: 12_000, endMs: 16_000, snap: 'bars', startPercent: 100 }))
      expect(useLoopTrainerStore.getState().config.savedLoopId).toBe(vi.mocked(putSavedLoop).mock.calls[0]![0].id)
    })

    it('recalls a saved loop with its range, grid and speed', () => {
      mockMode('practice', 12_500, GRID_VARIANT)
      useSavedLoopsStore.setState({ loops: [SOLO, { ...SOLO, id: 'other', variantId: 'v2', name: 'Andere Variante' }] })
      render(<LoopTrainerWidget config={{}} />)
      fireEvent.click(screen.getByRole('button', { name: '1 gespeicherter Loop' }))
      expect(screen.queryByText('Andere Variante')).not.toBeInTheDocument()
      expect(screen.getByText('Takt 11–15 · Tempo 80 → 100 %')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Solo'))
      expect(useLoopTrainerStore.getState().config).toMatchObject({ startMs: 20_000, endMs: 28_000, startPercent: 80, trainerEnabled: true, savedLoopId: 'l1' })
      expect(screen.getByRole('button', { name: 'Solo' })).toBeInTheDocument()
    })

    it('saves changes to the recalled loop for everyone', () => {
      mockMode('practice', 12_500, GRID_VARIANT)
      useSavedLoopsStore.setState({ loops: [SOLO] })
      useLoopTrainerStore.getState().setConfig('e1', { ...SOLO, savedLoopId: 'l1' })
      render(<LoopTrainerWidget config={{}} />)
      fireEvent.click(screen.getByLabelText('B erhöhen'))
      fireEvent.click(screen.getByRole('button', { name: 'Solo · geändert' }))
      fireEvent.click(screen.getByRole('button', { name: 'Änderungen an „Solo“ speichern' }))
      expect(vi.mocked(putSavedLoop)).toHaveBeenCalledWith({ ...SOLO, endMs: 30_000 })
    })

    it('asks before deleting a loop', () => {
      mockMode('practice', 12_500, GRID_VARIANT)
      useSavedLoopsStore.setState({ loops: [SOLO] })
      render(<LoopTrainerWidget config={{}} />)
      fireEvent.click(screen.getByRole('button', { name: '1 gespeicherter Loop' }))
      fireEvent.click(screen.getByRole('button', { name: 'Menü: Solo' }))
      fireEvent.click(screen.getByRole('button', { name: 'Löschen' }))
      expect(vi.mocked(removeSavedLoop)).not.toHaveBeenCalled()
      expect(screen.getByText('Der Loop verschwindet für die ganze Band.')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Löschen' }))
      expect(vi.mocked(removeSavedLoop)).toHaveBeenCalledWith('l1')
    })
  })
})
