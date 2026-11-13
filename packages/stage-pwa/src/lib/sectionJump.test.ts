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

const { cancelSectionJump, practiceStartAt, queueSectionJump, setSectionLoop, useSectionJumpDriver } = await import('./sectionJump')
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

  it('the loop trainer (#683): each pass back to A carries the next speed, the last one holds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    // Song 8 s at 100 000, at 50 %: the loop 8-16 s takes 16 s of clock time per pass.
    usePracticeStateStore.setState({
      byWorkspace: {
        band: { ...DEFAULT_PRACTICE_STATE, playbackStatus: 'playing', playbackStartedAt: 100_000, playbackAccumulatedMs: 8000, playbackRate: 0.5, playbackLoop: { startMs: 8000, endMs: 16_000, rates: [0.5, 0.75], pass: 0 } },
      },
    })
    renderHook(() => useSectionJumpDriver())
    // 1 s of song before the end is 2 s of clock at half speed - inside the notice.
    clock.now = 114_000
    await act(async () => vi.advanceTimersByTime(100))
    expect(practice().playbackJump).toEqual({ at: 116_000, toMs: 8000, rate: 0.75 })
    clock.now = 116_050
    await act(async () => vi.advanceTimersByTime(100))
    expect(practice()).toMatchObject({ playbackStartedAt: 116_000, playbackAccumulatedMs: 8000, playbackRate: 0.75, playbackJump: null, playbackLoop: { pass: 1 } })
    // Pass 2 at 75 %: 8 s of song in 10.67 s; the way back keeps the last speed.
    clock.now = 116_000 + 9_500
    await act(async () => vi.advanceTimersByTime(100))
    expect(practice().playbackJump).toMatchObject({ at: 116_000 + 8000 / 0.75, toMs: 8000, rate: 0.75 })
    vi.useRealTimers()
  })

  it('releasing the trainer loop goes back to the song tempo without moving the position (#683)', async () => {
    usePracticeStateStore.setState({
      byWorkspace: { band: { ...DEFAULT_PRACTICE_STATE, playbackStatus: 'playing', playbackStartedAt: 100_000, playbackAccumulatedMs: 8000, playbackRate: 0.5, playbackLoop: { startMs: 8000, endMs: 16_000, rates: [0.5] } } },
    })
    clock.now = 104_000
    await setSectionLoop(null)
    expect(practice()).toMatchObject({ playbackStartedAt: 104_000, playbackAccumulatedMs: 10_000, playbackRate: 1, playbackLoop: null })
  })
})

describe('Solo: start at a tapped line or section (#817)', () => {
  const practice = () => usePracticeStateStore.getState().get('band')
  beforeEach(() => {
    mode.value = 'practice'
    vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
  })
  afterEach(() => vi.restoreAllMocks())

  it('stopped: paused at that point, so Play starts there', () => {
    usePracticeStateStore.setState({ byWorkspace: { band: { ...DEFAULT_PRACTICE_STATE, playbackStatus: 'stopped' } } })
    expect(practiceStartAt(73_620)).toBe(true)
    expect(practice()).toMatchObject({ playbackStatus: 'paused', playbackStartedAt: null, playbackAccumulatedMs: 73_620, playbackJump: null })
  })

  it('playing: jumps there at once', () => {
    clock.now = 200_000
    usePracticeStateStore.setState({ byWorkspace: { band: { ...DEFAULT_PRACTICE_STATE, playbackStatus: 'playing', playbackStartedAt: 100_000, playbackAccumulatedMs: 0 } } })
    practiceStartAt(34_000)
    expect(practice()).toMatchObject({ playbackStatus: 'playing', playbackStartedAt: 200_000, playbackAccumulatedMs: 34_000 })
  })

  it("never in the Gig - the master's transport is the band's", () => {
    mode.value = 'gig'
    usePracticeStateStore.setState({ byWorkspace: { band: { ...DEFAULT_PRACTICE_STATE } } })
    expect(practiceStartAt(5000)).toBe(false)
    expect(practice().playbackAccumulatedMs).toBe(DEFAULT_PRACTICE_STATE.playbackAccumulatedMs)
  })
})
