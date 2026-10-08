import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetlistEntry, Song, SongVariant } from 'shared-types'
import { StatusBar } from './StatusBar'
import { useShowMode } from '../lib/showMode'

vi.mock('../lib/showMode', () => {
  // useShowElapsed (#457) reads the position the test put into the mocked useShowMode value.
  const useShowMode = vi.fn()
  const usePosition = () => (useShowMode() as { elapsedMs?: number | null } | undefined)?.elapsedMs ?? null
  return { useShowMode, useShowElapsed: (select: (ms: number | null) => unknown) => select(usePosition()) }
})
vi.mock('../lib/useActiveProfile', () => ({ useActiveProfile: () => ({ id: 'p', name: 'Marco' }) }))
vi.mock('../lib/useNow', () => ({ useNow: () => new Date('2026-09-27T21:07:00').getTime() }))
const stores = vi.hoisted(() => ({ masterHolderId: 'tablet' as string | null, audioError: null as string | null }))
vi.mock('../store/useShowStateStore', () => ({
  useShowStateStore: (select: (s: { state: { masterHolderId: string | null } }) => unknown) =>
    select({ state: { masterHolderId: stores.masterHolderId } }),
}))
vi.mock('../store/useLocalAudioOutputStore', () => ({
  useLocalAudioOutputStore: (select: (s: { error: string | null }) => unknown) => select({ error: stores.audioError }),
}))
vi.mock('../store/useSyncStore', () => ({
  useSyncStore: (select: (s: { streams: object; browserOffline: boolean }) => unknown) => select({ streams: {}, browserOffline: false }),
  deriveSyncStatus: () => 'idle',
}))

const song: Song = { id: 's', title: 'Free Bird', bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }
const entry: SetlistEntry = { id: 'e', songId: 's', variantId: null, trackId: null }
// 120 BPM, one count-in bar of 4/4 = 2 s before beat one; 180 s long.
const variant = {
  id: 'v',
  songId: 's',
  label: 'Original',
  isDefault: true,
  bpm: 120,
  timeSignature: '4/4',
  countInEnabled: true,
  countInBars: 1,
  durationMs: 180_000,
  tracks: [],
} as unknown as SongVariant

function mockShow(playbackStatus: 'playing' | 'paused' | 'stopped', elapsedMs: number | null, canControl = true, trackEnded = false) {
  vi.mocked(useShowMode).mockReturnValue({
    trackEnded,
    mode: 'gig',
    queue: { currentEntry: entry, currentSong: song, currentVariant: variant },
    elapsedMs,
    playbackStatus,
    liveTempoAdjustPercent: 0,
    trackOverride: null,
    canControl,
  } as never)
}

const bar = () => screen.getByRole('banner')

beforeEach(() => {
  stores.masterHolderId = 'tablet'
  stores.audioError = null
})

describe('StatusBar (PR F2)', () => {
  it('shows state, song, time, mode, Master crown, clock, musician and sync', () => {
    mockShow('playing', 65_000)
    render(<StatusBar screen="boards" onOpenMenu={vi.fn()} />)
    expect(bar().dataset.status).toBe('playing')
    expect(bar().className).toContain('bg-state-playing')
    expect(bar().textContent).toContain('Spielt')
    expect(bar().textContent).toContain('Free Bird')
    expect(bar().textContent).toContain('1:05 / 3:00')
    expect(bar().textContent).toContain('Gig')
    expect(screen.getByLabelText('Master')).toBeInTheDocument()
    expect(bar().textContent).toContain('21:07')
    expect(bar().textContent).toContain('Marco')
    expect(screen.getByLabelText('Synchron')).toBeInTheDocument()
  })

  it('keeps the bar calm blue and flashes only the count block on each count-in beat', () => {
    // 2 s count-in: beat 1 at -2000, beat 2 at -1500 ms.
    mockShow('playing', -1_450)
    const { rerender } = render(<StatusBar screen="boards" onOpenMenu={vi.fn()} />)
    expect(bar().dataset.status).toBe('count-in')
    expect(bar().className).toContain('bg-state-count-in')
    const block = screen.getByRole('status')
    expect(block).toHaveAccessibleName('Einzählen, Takt 1 von 1, Schlag 2')
    expect(block.dataset.flash).toBe('true')
    expect(block.className).toContain('bg-state-count-in-ink')

    mockShow('playing', -1_200)
    rerender(<StatusBar screen="boards" onOpenMenu={vi.fn()} />)
    expect(bar().className).toContain('bg-state-count-in')
    expect(screen.getByRole('status').dataset.flash).toBe('false')
    // Time counts down cleanly, never "-0:00".
    expect(bar().textContent).toContain('-0:02 / 3:00')
  })

  it('turns "Beendet" (magenta) when the shared state says the track ran out - not after a plain Stop', () => {
    mockShow('stopped', null, true, true)
    const { rerender } = render(<StatusBar screen="boards" onOpenMenu={vi.fn()} />)
    expect(bar().dataset.status).toBe('finished')
    expect(bar().className).toContain('bg-state-finished')

    mockShow('stopped', null, true, false)
    rerender(<StatusBar screen="boards" onOpenMenu={vi.fn()} />)
    expect(bar().dataset.status).toBe('ready')
  })

  it('goes red with the fault named when nobody holds the Master token in Gig mode', () => {
    stores.masterHolderId = null
    mockShow('stopped', null, false)
    render(<StatusBar screen="boards" onOpenMenu={vi.fn()} />)
    expect(bar().className).toContain('bg-state-fault')
    expect(bar().textContent).toContain('Kein Master')
    expect(screen.queryByLabelText('Master')).not.toBeInTheDocument()
  })

  it('opens the menu from its ☰ button', () => {
    mockShow('stopped', null)
    const onOpenMenu = vi.fn()
    render(<StatusBar screen="boards" onOpenMenu={onOpenMenu} />)
    screen.getByLabelText('Menü öffnen').click()
    expect(onOpenMenu).toHaveBeenCalled()
  })
})
