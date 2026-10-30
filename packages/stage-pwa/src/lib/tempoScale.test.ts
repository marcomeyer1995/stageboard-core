import { describe, expect, it } from 'vitest'
import type { BeatGrid, ShowCue } from 'shared-types'
import { clickTimeline } from './beatGrid'
import { scaleSongTempo } from './tempoScale'

const grid: BeatGrid = { points: [{ id: 'a', bar: 1, timeMs: 0 }, { id: 'b', bar: 41, timeMs: 64_000 }], meters: [] }
// 150 BPM: a beat is 400 ms, a bar 1600 ms. Bar 33 starts at 51.2 s.
const song = {
  bpm: 150,
  beatGrid: grid,
  timeSignature: '4/4',
  cues: [
    { id: 'mute', timeMs: 39_545, targetLogicalDeviceId: 'playback', type: 'playback', payload: { track: { db: null } } },
    { id: 'normal', timeMs: 51_200, anchor: { bar: 33, beat: 1 }, targetLogicalDeviceId: 'playback', type: 'playback', payload: { track: { db: 0 } } },
    { id: 'offbeat', timeMs: 51_600, anchor: { bar: 33, beat: 2 }, targetLogicalDeviceId: 'playback', type: 'playback', payload: { click: 'off' } },
  ] as ShowCue[],
  chordProContent: '{part: Chorus}\n{x_bar: 33}\nAll the small things',
}

describe('scaleSongTempo (#654)', () => {
  it('×2: anchored cues keep their moment and take the new bar - the track comes back where it did', () => {
    const doubled = scaleSongTempo(song, 2)
    expect(doubled.bpm).toBe(300)
    const normal = doubled.cues.find((c) => c.id === 'normal')!
    expect(normal.timeMs).toBe(51_200)
    expect(normal.anchor).toEqual({ bar: 65, beat: 1 })
    // Bar 33 beat 2 (51.6 s) is beat 3 of bar 65 on the doubled grid.
    expect(doubled.cues.find((c) => c.id === 'offbeat')!.anchor).toEqual({ bar: 65, beat: 3 })
    expect(doubled.cues.find((c) => c.id === 'mute')).toEqual(song.cues[0])
    expect(doubled.chordProContent).toContain('{x_bar: 65}')
    // The anchor really points at the cue's moment on the new grid.
    const after = clickTimeline({ beatGrid: doubled.beatGrid, bpm: doubled.bpm, timeSignature: '4/4' })
    expect(after.timeOfBeat(after.barStartBeat(65))).toBeCloseTo(51_200, 0)
  })

  it('×2 then ÷2 gives the song back', () => {
    const back = scaleSongTempo({ ...song, ...scaleSongTempo(song, 2) }, 0.5)
    expect(back.bpm).toBe(150)
    expect(back.beatGrid).toEqual(grid)
    expect(back.cues).toEqual(song.cues)
    expect(back.chordProContent).toBe(song.chordProContent)
  })

  it('÷2: a cue between two of the new beats becomes free, at its time', () => {
    const halved = scaleSongTempo(song, 0.5)
    const offbeat = halved.cues.find((c) => c.id === 'offbeat')!
    expect(offbeat.timeMs).toBe(51_600)
    expect(offbeat.anchor).toBeUndefined()
    expect(halved.cues.find((c) => c.id === 'normal')!.anchor).toEqual({ bar: 17, beat: 1 })
  })
})
