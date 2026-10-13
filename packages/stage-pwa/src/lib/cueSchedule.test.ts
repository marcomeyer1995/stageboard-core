import { describe, expect, it } from 'vitest'
import type { ShowCue } from 'shared-types'
import { cueDueAt, cuesToSchedule, passedCueIds, songTimeAt, type CueTransport } from './cueSchedule'

function cue(id: string, timeMs: number): ShowCue {
  return { id, timeMs, type: 'kemper.selectRig', targetLogicalDeviceId: 'kemper' }
}

const playing = (startedAt: number, accumulatedMs = 0): CueTransport => ({ status: 'playing', startedAt, accumulatedMs })

describe('cue schedule (#477)', () => {
  it('maps song time to server time from the transport anchor', () => {
    expect(cueDueAt(playing(10_000), 2_500)).toBe(12_500)
    // Resumed after a pause at 4 s: the new stretch starts at 20 s.
    expect(cueDueAt(playing(20_000, 4_000), 5_000)).toBe(21_000)
    expect(cueDueAt({ status: 'paused', startedAt: null, accumulatedMs: 4_000 }, 5_000)).toBeNull()
  })

  it('song time is negative during the Play lead', () => {
    expect(songTimeAt(playing(10_400), 10_000)).toBe(-400)
  })

  it('a cue at 0 is not "passed" during the Play lead - it fires at song time 0, not at the Play press', () => {
    const cues = [cue('a', 0), cue('b', 1_000)]
    const transport = playing(10_400)
    expect(passedCueIds(cues, transport, 10_000)).toEqual([])
    expect(cuesToSchedule(cues, transport, 10_000, new Set())).toEqual([])
    expect(cuesToSchedule(cues, transport, 10_320, new Set())).toEqual([{ cue: cues[0], dueAt: 10_400 }])
  })

  it('a device joining mid-song skips cues behind the position', () => {
    const cues = [cue('a', 1_000), cue('b', 5_000), cue('c', 9_000)]
    expect(passedCueIds(cues, playing(0), 5_000)).toEqual(['a'])
  })

  it('hands over only cues within the lookahead window, in time order, never twice', () => {
    const cues = [cue('late', 3_000), cue('soon', 1_050), cue('now', 1_000)]
    const transport = playing(0)
    expect(cuesToSchedule(cues, transport, 980, new Set(), 100).map((d) => d.cue.id)).toEqual(['now', 'soon'])
    expect(cuesToSchedule(cues, transport, 980, new Set(['now']), 100).map((d) => d.cue.id)).toEqual(['soon'])
  })

  it('still hands over a cue whose moment a late tick already missed', () => {
    expect(cuesToSchedule([cue('a', 1_000)], playing(0), 1_200, new Set())).toEqual([{ cue: cue('a', 1_000), dueAt: 1_000 }])
  })

  it('schedules nothing while paused or stopped', () => {
    const cues = [cue('a', 1_000)]
    expect(cuesToSchedule(cues, { status: 'paused', startedAt: null, accumulatedMs: 900 }, 0, new Set())).toEqual([])
    expect(cuesToSchedule(cues, { status: 'stopped', startedAt: null, accumulatedMs: 0 }, 0, new Set())).toEqual([])
  })
})
