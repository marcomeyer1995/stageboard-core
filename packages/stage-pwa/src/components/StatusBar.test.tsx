import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SetlistEntry, Song, SongVariant } from 'shared-types'
import { StatusBar } from './StatusBar'
import { useShowMode } from '../lib/showMode'
import { useEditingTitleStore } from '../store/useEditingTitleStore'

vi.mock('../lib/showMode', () => {
  const show = vi.fn()
  // The bar reads the core and the clock per frame (#457) - the same mocked show.
  return { useShowMode: show, useShowModeCore: () => ({ ...show(), elapsedNow: () => show().elapsedMs }) }
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
const loop = vi.hoisted(() => ({ state: null as { pass: number; rate: number } | null, stop: vi.fn() }))
vi.mock('../lib/loopTrainerEngine', () => ({ getLoopPlaybackState: () => loop.state }))
vi.mock('../lib/loopTrainer', () => ({ stopLoopTrainer: loop.stop }))
vi.mock('../store/useLoopTrainerStore', () => ({
  useLoopTrainerStore: (select: (s: { active: boolean }) => unknown) => select({ active: loop.state !== null }),
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
    queue: { currentEntry: entry, currentSong: song, currentVariant: variant, currentArrangement: variant ?? song },
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
  loop.state = null
  loop.stop.mockClear()
  useEditingTitleStore.setState({ editing: null })
})

describe('StatusBar (PR F2)', () => {
  it('carries the bento menu top right on dashboards only (docs/15 D8)', () => {
    mockShow('stopped', null)
    const onOpenDashboards = vi.fn()
    const { rerender } = render(<StatusBar screen="boards" onOpenMenu={vi.fn()} onOpenDashboards={onOpenDashboards} />)
    const bento = screen.getByRole('button', { name: 'Dashboards' })
    expect(bento.parentElement?.lastElementChild).toBe(bento)
    fireEvent.click(bento)
    expect(onOpenDashboards).toHaveBeenCalled()
    rerender(<StatusBar screen="library" onOpenMenu={vi.fn()} onOpenDashboards={onOpenDashboards} />)
    expect(screen.queryByRole('button', { name: 'Dashboards' })).not.toBeInTheDocument()
  })

  it('☰ and the nine dots show yellow while their drawer is open - the same symbol closes it (2026-10-16)', () => {
    mockShow('stopped', null)
    render(<StatusBar screen="boards" onOpenMenu={vi.fn()} onOpenDashboards={vi.fn()} menuOpen />)
    expect(screen.getByRole('button', { name: 'Menü öffnen' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Menü öffnen' })).toHaveClass('bg-accent')
    expect(screen.getByRole('button', { name: 'Dashboards' })).toHaveAttribute('aria-pressed', 'false')
  })

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
    // 2 s count-in: beat 1 at -2000, beat 2 at -1500 ms. The bar reads the clock per frame (#457).
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
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
    act(() => vi.advanceTimersToNextFrame())
    expect(bar().className).toContain('bg-state-count-in')
    expect(screen.getByRole('status').dataset.flash).toBe('false')
    // Time counts down cleanly, never "-0:00".
    expect(bar().textContent).toContain('-0:02 / 3:00')
    vi.useRealTimers()
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

  it('shows a running loop with pass and tempo, and stops it on a tap - from any dashboard (2026-10-22)', () => {
    mockShow('playing', 12_000)
    loop.state = { pass: 2, rate: 0.85 }
    render(<StatusBar screen="boards" onOpenMenu={vi.fn()} />)
    expect(bar()).toHaveAttribute('data-status', 'loop')
    const stop = screen.getByRole('button', { name: /Loop · 3 · 85 %.*Loop stoppen/ })
    fireEvent.click(stop)
    expect(loop.stop).toHaveBeenCalled()
  })

  it('opens the menu from its ☰ button', () => {
    mockShow('stopped', null)
    const onOpenMenu = vi.fn()
    render(<StatusBar screen="boards" onOpenMenu={onOpenMenu} />)
    screen.getByLabelText('Menü öffnen').click()
    expect(onOpenMenu).toHaveBeenCalled()
  })
})

describe('StatusBar - while an editor is open (#603)', () => {
  it('names the edited song and variant instead of the queue song, also while playing; state and sync stay', () => {
    mockShow('playing', 65_000)
    useEditingTitleStore.setState({ editing: { title: 'All the small things', variantLabel: 'Abadschen' } })
    const { rerender } = render(<StatusBar screen="library" onOpenMenu={vi.fn()} />)
    expect(bar().textContent).toContain('All the small things')
    expect(bar().textContent).toContain('Abadschen')
    expect(screen.getByLabelText('Bearbeitet')).toBeInTheDocument()
    expect(bar().textContent).not.toContain('Free Bird')
    expect(bar().textContent).not.toContain('1:05')
    expect(bar().dataset.status).toBe('playing')
    expect(screen.getByLabelText('Synchron')).toBeInTheDocument()

    useEditingTitleStore.setState({ editing: null })
    rerender(<StatusBar screen="library" onOpenMenu={vi.fn()} />)
    expect(bar().textContent).toContain('Free Bird')
    expect(bar().textContent).toContain('1:05')
  })

  it('a fault shows only its red icon while editing - the word comes back after leaving the editor (2026-10-20)', () => {
    stores.masterHolderId = null
    mockShow('stopped', null, false)
    useEditingTitleStore.setState({ editing: { title: 'All the small things', variantLabel: '' } })
    const { rerender } = render(<StatusBar screen="library" onOpenMenu={vi.fn()} />)
    expect(bar().className).toContain('bg-state-fault')
    expect(screen.getByLabelText('Kein Master')).toBeInTheDocument()
    expect(screen.getByText('Kein Master').className).toContain('invisible')

    useEditingTitleStore.setState({ editing: null })
    rerender(<StatusBar screen="library" onOpenMenu={vi.fn()} />)
    expect(screen.getByText('Kein Master').className).not.toContain('invisible')
  })
})
