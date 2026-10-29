import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHOW_STATE, type ShowState } from 'shared-types'
import { clickTimeline } from './beatGrid'

const clock = vi.hoisted(() => ({ now: 0 }))
vi.mock('./clockSync', () => ({ getServerTime: () => clock.now }))

const store = vi.hoisted(() => {
  const s = {
    isMaster: true,
    deviceId: 'dev-1',
    state: {} as ShowState,
    applyPatch: async (patch: Partial<ShowState>) => {
      s.state = { ...s.state, ...patch }
    },
  }
  return s
})
vi.mock('../store/useShowStateStore', () => ({
  useShowStateStore: { getState: () => store },
  drivesAutomation: (s: typeof store) => s.isMaster,
}))

const mode = vi.hoisted(() => ({ value: 'gig' as 'gig' | 'practice' }))
vi.mock('../store/useAppModeStore', () => ({ useAppModeStore: { getState: () => ({ mode: mode.value }) } }))
vi.mock('../store/useWorkspaceStore', () => ({ useWorkspaceStore: { getState: () => ({ activeWorkspaceId: 'band' }) } }))

const { cancelSectionJump, queueSectionJump, setSectionLoop, useSectionJumpDriver } = await import('./sectionJump')
const { usePracticeStateStore, DEFAULT_PRACTICE_STATE } = await import('../store/usePracticeStateStore')

const timeline = clickTimeline({ bpm: 120, timeSignature: '4/4' })
const sections = [
  { label: 'Verse', startMs: 0, endMs: 8000 },
  { label: 'Chorus', startMs: 8000, endMs: 16000 },
]

beforeEach(() => {
  // Song time = server time - 100 000 (started at 100 s, from 0).
  store.state = { ...DEFAULT_SHOW_STATE, playbackStatus: 'playing', playbackStartedAt: 100_000, playbackAccumulatedMs: 0 }
  store.isMaster = true
  mode.value = 'gig'
})

describe('queueSectionJump (#479)', () => {
  it('queues the jump at the next bar line at least a second ahead', async () => {
    clock.now = 103_500 // song 3.5 s -> earliest 4.5 s -> bar line 6 s
    expect(await queueSectionJump(sections[1], 'bar', sections, timeline)).toBe('queued')
    expect(store.state.playbackJump).toEqual({ at: 106_000, toMs: 8000, label: 'Chorus' })
  })

  it('or at the end of the section playing', async () => {
    clock.now = 103_500
    await queueSectionJump(sections[0], 'section', sections, timeline)
    expect(store.state.playbackJump).toMatchObject({ at: 108_000, toMs: 0 })
  })

  it('only the master, only while playing', async () => {
    store.isMaster = false
    expect(await queueSectionJump(sections[1], 'bar', sections, timeline)).toBe('not-master')
    store.isMaster = true
    store.state = { ...store.state, playbackStatus: 'paused', playbackStartedAt: null }
    expect(await queueSectionJump(sections[1], 'bar', sections, timeline)).toBe('not-playing')
  })

  it('can be called off - not when it is too close', async () => {
    clock.now = 103_500
    await queueSectionJump(sections[1], 'bar', sections, timeline)
    clock.now = 105_900
    await cancelSectionJump()
    expect(store.state.playbackJump).not.toBeNull()
    clock.now = 104_000
    await cancelSectionJump()
    expect(store.state.playbackJump).toBeNull()
  })
})

describe('useSectionJumpDriver (#479)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('folds a passed jump into the anchor, and keeps a loop going pass after pass', async () => {
    renderHook(() => useSectionJumpDriver())
    await setSectionLoop(sections[1])
    // Song 14.6 s: 1.4 s before the end of the looped Chorus -> the way back is queued.
    clock.now = 114_600
    await act(async () => vi.advanceTimersByTime(100))
    expect(store.state.playbackJump).toMatchObject({ at: 116_000, toMs: 8000 })
    // Past it: folded - same song time, new anchor.
    clock.now = 116_200
    await act(async () => vi.advanceTimersByTime(100))
    expect(store.state).toMatchObject({ playbackStartedAt: 116_000, playbackAccumulatedMs: 8000, playbackJump: null })
    // Released: no further way back.
    await setSectionLoop(null)
    clock.now = 122_700
    await act(async () => vi.advanceTimersByTime(100))
    expect(store.state.playbackJump).toBeNull()
  })
})

describe('Solo Üben - the same jump on this device\'s own practice state (#479, 2026-10-22)', () => {
  const practice = () => usePracticeStateStore.getState().get('band')
  beforeEach(() => {
    mode.value = 'practice'
    vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
    usePracticeStateStore.setState({ byWorkspace: { band: { ...DEFAULT_PRACTICE_STATE, playbackStatus: 'playing', playbackStartedAt: 100_000, playbackAccumulatedMs: 0 } } })
    // The band's show state stands still - Solo never touches it.
    store.state = { ...DEFAULT_SHOW_STATE }
    store.isMaster = false
  })
  afterEach(() => vi.restoreAllMocks())

  it('queues on the practice state - no master needed - and leaves the show state alone', async () => {
    clock.now = 103_500
    expect(await queueSectionJump(sections[1], 'bar', sections, timeline)).toBe('queued')
    expect(practice().playbackJump).toEqual({ at: 106_000, toMs: 8000, label: 'Chorus' })
    expect(store.state.playbackJump ?? null).toBeNull()
    clock.now = 104_000
    await cancelSectionJump()
    expect(practice().playbackJump).toBeNull()
  })

  it('the driver folds the jump and loops the section in Solo too', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    renderHook(() => useSectionJumpDriver())
    await setSectionLoop(sections[1])
    clock.now = 114_600
    await act(async () => vi.advanceTimersByTime(100))
    expect(practice().playbackJump).toMatchObject({ at: 116_000, toMs: 8000 })
    clock.now = 116_200
    await act(async () => vi.advanceTimersByTime(100))
    expect(practice()).toMatchObject({ playbackStartedAt: 116_000, playbackAccumulatedMs: 8000, playbackJump: null })
    vi.useRealTimers()
  })
})
