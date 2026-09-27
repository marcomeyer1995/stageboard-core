import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetlistEntry, Song, SongVariant } from 'shared-types'
import { StatusBar } from './StatusBar'
import { useShowMode } from '../lib/showMode'

vi.mock('../lib/showMode', () => ({ useShowMode: vi.fn() }))
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
  beatAnchors: [],
  tempoMarkers: [],
} as unknown as SongVariant

function mockShow(playbackStatus: 'playing' | 'paused' | 'stopped', elapsedMs: number | null, canControl = true) {
  vi.mocked(useShowMode).mockReturnValue({
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
    render(<StatusBar screen="live" onOpenMenu={vi.fn()} />)
    expect(bar().dataset.status).toBe('playing')
    expect(bar().className).toContain('bg-green-700')
    expect(bar().textContent).toContain('Spielt')
    expect(bar().textContent).toContain('Free Bird')
    expect(bar().textContent).toContain('1:05 / 3:00')
    expect(bar().textContent).toContain('Gig')
    expect(screen.getByLabelText('Master')).toBeInTheDocument()
    expect(bar().textContent).toContain('21:07')
    expect(bar().textContent).toContain('Marco')
    expect(screen.getByLabelText('Synchron')).toBeInTheDocument()
  })

  it('flashes on each count-in beat and counts along, dark between beats', () => {
    // 2 s count-in: beat 1 at -2000, beat 2 at -1500 ms.
    mockShow('playing', -1_450)
    const { rerender } = render(<StatusBar screen="live" onOpenMenu={vi.fn()} />)
    expect(bar().dataset.status).toBe('count-in')
    expect(bar().textContent).toContain('Einzählen 2')
    expect(bar().className).toContain('bg-sky-300')

    mockShow('playing', -1_200)
    rerender(<StatusBar screen="live" onOpenMenu={vi.fn()} />)
    expect(bar().className).toContain('bg-blue-700')
  })

  it('turns "Beendet" (magenta) when a run stops at the song\'s end, not after a false start', () => {
    mockShow('playing', 179_000)
    const { rerender } = render(<StatusBar screen="live" onOpenMenu={vi.fn()} />)
    mockShow('stopped', null)
    rerender(<StatusBar screen="live" onOpenMenu={vi.fn()} />)
    expect(bar().dataset.status).toBe('finished')
    expect(bar().className).toContain('bg-fuchsia-700')

    mockShow('playing', 3_000)
    rerender(<StatusBar screen="live" onOpenMenu={vi.fn()} />)
    mockShow('stopped', null)
    rerender(<StatusBar screen="live" onOpenMenu={vi.fn()} />)
    expect(bar().dataset.status).toBe('ready')
  })

  it('goes red with the fault named when nobody holds the Master token in Gig mode', () => {
    stores.masterHolderId = null
    mockShow('stopped', null, false)
    render(<StatusBar screen="live" onOpenMenu={vi.fn()} />)
    expect(bar().className).toContain('bg-red-600')
    expect(bar().textContent).toContain('Kein Master')
    expect(screen.queryByLabelText('Master')).not.toBeInTheDocument()
  })

  it('opens the menu from its ☰ button', () => {
    mockShow('stopped', null)
    const onOpenMenu = vi.fn()
    render(<StatusBar screen="live" onOpenMenu={onOpenMenu} />)
    screen.getByLabelText('Menü öffnen').click()
    expect(onOpenMenu).toHaveBeenCalled()
  })
})
