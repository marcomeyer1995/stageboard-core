import { describe, expect, it } from 'vitest'
import { finishedAfterRun, formatSongTime, statusBarState, type StatusBarInput } from './statusBar'

const base: StatusBarInput = {
  mode: 'gig',
  playbackStatus: 'stopped',
  isCountIn: false,
  finished: false,
  noMaster: false,
  syncStatus: 'idle',
  audioError: null,
}

describe('statusBarState', () => {
  it('maps the transport to ready / count-in / playing / paused / finished', () => {
    expect(statusBarState(base)).toEqual({ kind: 'ready', label: 'Bereit' })
    expect(statusBarState({ ...base, playbackStatus: 'playing', isCountIn: true }).kind).toBe('count-in')
    expect(statusBarState({ ...base, playbackStatus: 'playing' }).kind).toBe('playing')
    expect(statusBarState({ ...base, playbackStatus: 'paused' }).kind).toBe('paused')
    expect(statusBarState({ ...base, finished: true })).toEqual({ kind: 'finished', label: 'Beendet' })
  })

  it('shows faults - and only faults - in red, ahead of the transport state', () => {
    expect(statusBarState({ ...base, playbackStatus: 'playing', audioError: 'kaputt' })).toEqual({ kind: 'fault', label: 'Audio-Fehler' })
    expect(statusBarState({ ...base, syncStatus: 'error' }).label).toBe('Sync-Fehler')
    expect(statusBarState({ ...base, syncStatus: 'offline' }).label).toBe('Offline')
    expect(statusBarState({ ...base, noMaster: true }).label).toBe('Kein Master')
  })

  it('does not count offline or a missing Master as faults in Solo Üben', () => {
    expect(statusBarState({ ...base, mode: 'practice', syncStatus: 'offline', noMaster: true }).kind).toBe('ready')
  })
})

describe('finishedAfterRun', () => {
  it('counts a run that reached the last few seconds of the song', () => {
    expect(finishedAfterRun(180_000, 180_000)).toBe(true)
    expect(finishedAfterRun(176_000, 180_000)).toBe(true)
  })

  it('does not count a false start, or a song without a known length', () => {
    expect(finishedAfterRun(12_000, 180_000)).toBe(false)
    expect(finishedAfterRun(180_000, null)).toBe(false)
    expect(finishedAfterRun(null, 180_000)).toBe(false)
  })
})

describe('formatSongTime', () => {
  it('formats minutes and seconds, negative during the count-in', () => {
    expect(formatSongTime(187_400)).toBe('3:07')
    expect(formatSongTime(-2_100)).toBe('-0:02')
    expect(formatSongTime(0)).toBe('0:00')
  })
})
