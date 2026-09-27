import { describe, expect, it } from 'vitest'
import { countInPosition, finishedAfterRun, formatSongTime, statusBarState, type StatusBarInput } from './statusBar'

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
  it('formats minutes and seconds, a clean countdown during the count-in', () => {
    expect(formatSongTime(187_400)).toBe('3:07')
    // Rounded up before beat one - measured on the tablet it showed "-0:00" first.
    expect(formatSongTime(-2_100)).toBe('-0:03')
    expect(formatSongTime(-1_000)).toBe('-0:01')
    expect(formatSongTime(-400)).toBe('-0:01')
    expect(formatSongTime(0)).toBe('0:00')
  })
})

describe('countInPosition', () => {
  // Measured case: "Rebell Yell", 2 count-in bars of 4/4 before a first beat anchor at 1790 ms,
  // ~158 BPM (380 ms per beat) -> count-in from 1790 - 8 * 380 = -1250 ms.
  const at = (index: number, msIntoBeat = 10) => {
    const elapsed = -1250 + index * 380 + msIntoBeat
    return countInPosition(elapsed, msIntoBeat, 60000 / 380, 1790, 2, index % 4, 4)
  }

  it('counts bar 1 beats 1-4, then bar 2 beats 1-4', () => {
    expect([0, 1, 2, 3, 4, 7].map((i) => [at(i).bar, at(i).beat])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 1],
      [2, 4],
    ])
    expect(at(0).bars).toBe(2)
  })

  it('stays in the right bar late in a beat', () => {
    expect(at(3, 370).bar).toBe(1)
    expect(at(4, 0).bar).toBe(2)
  })
})
