import { describe, expect, it } from 'vitest'
import { clickTimeline } from './beatGrid'
import { beatAt } from './metronome'
import { countInPosition, formatSongTime, statusBarState, type StatusBarInput } from './statusBar'

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
    expect(statusBarState(base)).toEqual({ kind: 'ready', label: 'ready' })
    expect(statusBarState({ ...base, playbackStatus: 'playing', isCountIn: true }).kind).toBe('count-in')
    expect(statusBarState({ ...base, playbackStatus: 'playing' }).kind).toBe('playing')
    expect(statusBarState({ ...base, playbackStatus: 'paused' }).kind).toBe('paused')
    expect(statusBarState({ ...base, finished: true })).toEqual({ kind: 'finished', label: 'finished' })
  })

  it('shows faults - and only faults - in red, ahead of the transport state', () => {
    expect(statusBarState({ ...base, playbackStatus: 'playing', audioError: 'kaputt' })).toEqual({ kind: 'fault', label: 'audioError' })
    expect(statusBarState({ ...base, syncStatus: 'error' }).label).toBe('syncError')
    expect(statusBarState({ ...base, syncStatus: 'offline' }).label).toBe('offline')
    expect(statusBarState({ ...base, noMaster: true }).label).toBe('noMaster')
  })

  it('does not count offline or a missing Master as faults in Solo Üben', () => {
    expect(statusBarState({ ...base, mode: 'practice', syncStatus: 'offline', noMaster: true }).kind).toBe('ready')
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

describe('countInPosition with a corrected tempo (real beatAt)', () => {
  it('changes bar exactly on beat 1 when the beats run faster than the authored tempo', () => {
    // Measured on the tablet: "Wie ein schützender Engel", 3 count-in bars at an authored
    // 114.3 BPM (525 ms), but the grid's first stretch at 480 ms - the count-in runs at 480 ms per
    // beat. With the inverted effectiveBpm, "Takt 2" started on beat 3 and "Takt 3" on beat 4.
    const timeline = clickTimeline({ beatGrid: { points: [{ id: 'p1', bar: 1, timeMs: 460 }, { id: 'p2', bar: 2, timeMs: 460 + 4 * 480 }], meters: [] }, bpm: 114.3, timeSignature: '4/4', countInBars: 3 })
    const origin = 460 - 12 * 480
    const seen: string[] = []
    for (let i = 0; i < 12; i++) {
      const t = origin + i * 480 + 60
      const beat = beatAt(t, timeline)!
      const p = countInPosition(t, beat.msIntoBeat, beat.effectiveBpm, 460, 3, beat.beatInBar, 4)
      seen.push(`${p.bar}.${p.beat}`)
    }
    expect(seen).toEqual(['1.1', '1.2', '1.3', '1.4', '2.1', '2.2', '2.3', '2.4', '3.1', '3.2', '3.3', '3.4'])
  })
})
