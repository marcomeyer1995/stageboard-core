import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHOW_STATE, type ShowState, type Song } from 'shared-types'

// The stores behind the queue snapshot open PouchDB at import time - unavailable under
// happy-dom, same stand-in as the other store tests.
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    async get() {
      throw Object.assign(new Error('missing'), { status: 404 })
    }
    async put() {
      return { ok: true }
    }
    async allDocs() {
      return { rows: [] }
    }
    changes() {
      return { on: () => undefined, cancel: () => {} }
    }
  },
}))

const { playSong, pauseSong, PLAY_LEAD_MS } = await import('./queue')
const { computeActiveMs } = await import('./playbackTransport')
const { getServerTime } = await import('./clockSync')
const { useClockSyncStore } = await import('../store/useClockSyncStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { useSongsStore } = await import('../store/useSongsStore')

const song: Song = { id: 'song-1', title: 'Free Bird', bpm: 120, timeSignature: '4/4', clickTrackEnabled: false, chordProContent: '', timecodes: [] }

let state: ShowState
const applyPatch = vi.fn(async (patch: Partial<ShowState>) => {
  state = { ...state, ...patch }
  useShowStateStore.setState({ state })
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-27T20:00:00Z'))
  state = { ...DEFAULT_SHOW_STATE, activeEntryId: song.id, masterHolderId: 'me' }
  useShowStateStore.setState({ state, isMaster: true, applyPatch })
  useSongsStore.setState({ songs: [song] })
  // Measured on the band's tablet: its clock ran 2126 ms ahead of the Stage-Server.
  useClockSyncStore.getState().setSync({ offsetMs: -2126, rttMs: 20, jitterMs: 1, driftMs: 0 })
})

afterEach(() => {
  vi.useRealTimers()
  applyPatch.mockClear()
  useClockSyncStore.getState().reset()
})

const elapsed = () =>
  computeActiveMs({ status: state.playbackStatus, startedAt: state.playbackStartedAt, accumulatedMs: state.playbackAccumulatedMs }, getServerTime())

describe('Gig transport timestamps (server time, not the Master\'s own clock)', () => {
  it('stamps Play with server time, so the song clock runs from the first moment', async () => {
    await playSong()
    expect(state.playbackStartedAt).toBe(Date.now() - 2126)
    expect(state.activeEntryStartedAt).toBe(Date.now() - 2126)

    vi.advanceTimersByTime(500)
    // With Date.now() the clock stood at 0 for 2.1 s (max(0, serverNow - localStart)). Song time
    // starts PLAY_LEAD_MS before 0 (ahead-of-time start, #468).
    expect(elapsed()).toBe(500 - PLAY_LEAD_MS)
  })

  it('starts a fresh song ahead of time: song time 0 lies PLAY_LEAD_MS after Play, so every device can start exactly on it (#468)', async () => {
    await playSong()
    expect(elapsed()).toBe(-PLAY_LEAD_MS)
    vi.advanceTimersByTime(PLAY_LEAD_MS)
    expect(elapsed()).toBe(0)
  })

  it('pauses at the elapsed time every tablet saw', async () => {
    await playSong()
    vi.advanceTimersByTime(3000)
    await pauseSong()
    expect(state.playbackStatus).toBe('paused')
    expect(state.playbackAccumulatedMs).toBe(3000 - PLAY_LEAD_MS)
  })
})
