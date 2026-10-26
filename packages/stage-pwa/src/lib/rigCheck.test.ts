import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHOW_STATE, type ShowLogEvent, type ShowState } from 'shared-types'
import type { RigCheckRun } from './rigCheck'

// The stores open PouchDB at import time - unavailable under happy-dom, same stand-in as queue.test.ts.
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

const rig = await import('./rigCheck')
const song = await import('./rigCheckSong')
const { computeActiveMs, transportOf } = await import('./playbackTransport')
const { getServerTime } = await import('./clockSync')
const { getDeviceId } = await import('./deviceId')
const { useShowLogStore } = await import('../store/useShowLogStore')
const { useShowStateStore } = await import('../store/useShowStateStore')
const { useSongsStore } = await import('../store/useSongsStore')
const { useSongVariantsStore } = await import('../store/useSongVariantsStore')
const { useSetlistsStore } = await import('../store/useSetlistsStore')

let state: ShowState
let events: ShowLogEvent[]
const applyPatch = vi.fn(async (patch: Partial<ShowState>) => {
  state = { ...state, ...patch }
  useShowStateStore.setState({ state })
})
const append = vi.fn(async (event: ShowLogEvent) => {
  events = [...events.filter((e) => e.id !== event.id), event].sort((a, b) => a.at - b.at)
  useShowLogStore.setState({ events })
})

const quick = song.buildRigCheckSong('quick')
const track = { id: song.RIG_CHECK_TRACK_ID, kind: 'band-mix' as const, label: 'Rig-Check v1', source: 'upload' as const, parentTrackId: null, mimeType: 'audio/wav', addedAt: 0, durationMs: quick.durationMs }

/** The docs Vorbereiten writes, as they arrive on a device. */
function arrived() {
  useSongsStore.setState({ songs: [{ id: song.RIG_CHECK_SONG_ID, title: 'Rig-Check', bpm: 120, timeSignature: '4/4', clickTrackEnabled: true, chordProContent: quick.chordPro, timecodes: [] }] })
  useSongVariantsStore.setState({ variants: [song.rigCheckVariant(quick, [], [track])] })
  useSetlistsStore.setState({
    setlists: [{ id: song.RIG_CHECK_SETLIST_ID, name: 'Rig-Check', entries: [{ id: 'rig-check-entry-quick', songId: song.RIG_CHECK_SONG_ID, variantId: 'rig-check-quick', trackId: null }], createdAt: 0 }],
  })
}

function preparedRun(at = Math.round(getServerTime())): ShowLogEvent {
  return { id: 'rig-check-run-r1', showId: 'r1', type: 'rig-check-run', at, kind: 'quick', version: song.RIG_CHECK_VERSION }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-26T20:00:00Z'))
  state = { ...DEFAULT_SHOW_STATE, activeSetlistId: 'gig-setlist', activeEntryId: 'e7', currentShowId: 'tonight', lastActivityAt: 123, masterHolderId: 'me' }
  events = []
  useShowStateStore.setState({ state, isMaster: true, deviceId: 'me', applyPatch })
  useShowLogStore.setState({ events, append })
  arrived()
})

afterEach(() => {
  vi.useRealTimers()
  applyPatch.mockClear()
  append.mockClear()
})

describe('Rig-Check run state (#464)', () => {
  it('a prepared run is open; nobody starting it closes it after half an hour', () => {
    const run = preparedRun()
    expect(rig.openRun([run], getServerTime())).toEqual(run)
    expect(rig.openRun([run], getServerTime() + rig.RUN_OPEN_MS + 1)).toBeNull()
  })

  it('an ended run asks for the verdict for a quarter of an hour', () => {
    const now = getServerTime()
    const ended = { ...preparedRun(), startedAt: now, endedAt: now + 40_000 } as ShowLogEvent
    expect(rig.openRun([ended], now + 41_000)).toBeNull()
    expect(rig.verdictRun([ended], now + 41_000)).toEqual(ended)
    expect(rig.verdictRun([ended], now + 40_000 + rig.VERDICT_MS + 1)).toBeNull()
  })

  it('labels a Rig-Check show and leaves real shows alone', () => {
    expect(rig.rigCheckLabel([preparedRun()])).toBe('Rig-Check · Kurz')
    expect(rig.rigCheckLabel([{ ...preparedRun(), cancelled: true } as ShowLogEvent])).toBe('Rig-Check · Kurz (abgebrochen)')
    expect(rig.rigCheckLabel([{ id: 's', showId: 'tonight', type: 'show-started', at: 1 }])).toBeNull()
  })
})

describe('startRigCheck', () => {
  it('refuses without master, without a run, while a song plays, and before the docs arrived', async () => {
    useShowStateStore.setState({ isMaster: false })
    expect(await rig.startRigCheck()).toBe('not-master')
    useShowStateStore.setState({ isMaster: true })
    expect(await rig.startRigCheck()).toBe('no-run')
    await append(preparedRun())
    state = { ...state, playbackStatus: 'paused' }
    useShowStateStore.setState({ state })
    expect(await rig.startRigCheck()).toBe('busy')
    state = { ...state, playbackStatus: 'stopped' }
    useShowStateStore.setState({ state })
    useSetlistsStore.setState({ setlists: [] })
    expect(await rig.startRigCheck()).toBe('not-ready')
    expect(applyPatch).not.toHaveBeenCalled()
  })

  it('switches to the test song in its own show, plays it with count-in and remembers the show it came from', async () => {
    await append(preparedRun())
    expect(await rig.startRigCheck()).toBe('started')
    expect(state.activeSetlistId).toBe(song.RIG_CHECK_SETLIST_ID)
    expect(state.activeEntryId).toBe('rig-check-entry-quick')
    expect(state.currentShowId).toBe('r1')
    expect(state.playbackStatus).toBe('playing')
    // Count-in fits the lead-in: song time starts the ahead-of-time lead before 0, not a bar early.
    expect(computeActiveMs(transportOf(state), getServerTime())).toBeLessThan(0)
    const run = rig.latestRun(events)!
    expect(run.startedAt).toBeDefined()
    expect(run.previous).toEqual({ activeSetlistId: 'gig-setlist', activeEntryId: 'e7', currentShowId: 'tonight', lastActivityAt: 123 })
    expect(events.some((e) => e.type === 'show-started' && e.showId === 'r1')).toBe(true)
  })
})

describe('useRigCheckDriver', () => {
  it('queues the jump over the skipped section a bar into the section before it', async () => {
    await append(preparedRun())
    await rig.startRigCheck()
    renderHook(() => rig.useRigCheckDriver())
    // Two bars into "Gleichmäßig 120" (bar 1 at 2 s, 2 s per bar).
    vi.advanceTimersByTime(6000)
    expect(state.playbackJump).toBeTruthy()
    const steady = quick.sections.find((s) => s.name === 'steady')!
    const target = quick.sections.find((s) => s.label === quick.jump.to)!
    expect(state.playbackJump!.toMs).toBeCloseTo(target.timeMs, 0)
    expect(state.playbackJump!.label).toBe(quick.jump.to)
    // On the end of the section: song time at the jump is its last bar line.
    const jumpSongMs = state.playbackJump!.at - state.playbackStartedAt! + state.playbackAccumulatedMs
    expect(jumpSongMs).toBeCloseTo(steady.timeMs + steady.bars * 2000, 0)
  })

  it('at the track end it closes the run and brings the show back', async () => {
    await append(preparedRun())
    await rig.startRigCheck()
    renderHook(() => rig.useRigCheckDriver())
    vi.advanceTimersByTime(4000)
    // The auto-stop at the track end.
    state = { ...state, playbackStatus: 'stopped', playbackStartedAt: null, activeEntryStartedAt: null, trackEnded: true }
    useShowStateStore.setState({ state })
    await vi.advanceTimersByTimeAsync(300)
    const run = rig.latestRun(events)!
    expect(run.endedAt).toBeDefined()
    expect(run.cancelled).toBeUndefined()
    expect(state.activeSetlistId).toBe('gig-setlist')
    expect(state.activeEntryId).toBe('e7')
    expect(state.currentShowId).toBe('tonight')
    expect(state.lastActivityAt).toBe(123)
  })

  it('stopped before the end it counts as cancelled; a setlist picked meanwhile stays', async () => {
    await append(preparedRun())
    await rig.startRigCheck()
    renderHook(() => rig.useRigCheckDriver())
    vi.advanceTimersByTime(4000)
    state = { ...state, activeSetlistId: 'other', playbackStatus: 'stopped' }
    useShowStateStore.setState({ state })
    await vi.advanceTimersByTimeAsync(300)
    expect(rig.latestRun(events)!.cancelled).toBe(true)
    expect(state.activeSetlistId).toBe('other')
  })

  it('does nothing on a device that does not drive the show', async () => {
    await append(preparedRun())
    await rig.startRigCheck()
    applyPatch.mockClear()
    useShowStateStore.setState({ isMaster: false })
    renderHook(() => rig.useRigCheckDriver())
    vi.advanceTimersByTime(8000)
    expect(applyPatch).not.toHaveBeenCalled()
  })
})

describe('device reports', () => {
  it('keeps the verdict when the state is written again, and lists the reports by name', async () => {
    const run = preparedRun() as RigCheckRun
    await rig.writeOwnReport(run, false)
    await rig.writeOwnReport(run, true, { verdict: 'problem', note: '  Prompter zu spät ' })
    await rig.writeOwnReport(run, true)
    const reports = rig.runReports(events, 'r1')
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ id: rig.deviceReportId('r1', getDeviceId()), trackReady: true, verdict: 'problem', note: 'Prompter zu spät', mode: 'gig' })
  })
})
