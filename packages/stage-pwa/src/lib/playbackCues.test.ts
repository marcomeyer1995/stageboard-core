import { describe, expect, it } from 'vitest'
import type { ShowCue } from 'shared-types'
import { clickTimeline } from './beatGrid'
import { dbToGain, fadeDurationMs, levelAt, playbackCueContent, playbackCueLabel, playbackStateAt, playbackSwitches, trackLevelCurve, type TrackLevel } from './playbackCues'

const cue = (id: string, timeMs: number, click?: 'on' | 'off', voice?: 'on' | 'off'): ShowCue => ({ id, timeMs, ...playbackCueContent({ click, voice }) })
const device: ShowCue = { id: 'k', timeMs: 0, targetLogicalDeviceId: 'kemper', type: 'click', payload: { click: 'off' } }

describe('playback cues - Klick/Ansagen aus und an (#485)', () => {
  it('each switch holds from its cue until the next one that names it', () => {
    const cues = [cue('a', 10000, 'off'), cue('b', 20000, undefined, 'off'), cue('c', 30000, 'on', 'on'), device]
    expect(playbackStateAt(cues, 0)).toEqual({ click: true, voice: true })
    expect(playbackStateAt(cues, 10000)).toEqual({ click: false, voice: true })
    expect(playbackStateAt(cues, 9997)).toEqual({ click: false, voice: true }) // a downbeat a hair early still counts
    expect(playbackStateAt(cues, 25000)).toEqual({ click: false, voice: false })
    expect(playbackStateAt(cues, 30000)).toEqual({ click: true, voice: true })
  })

  it('names what it switches', () => {
    expect(playbackCueLabel(cue('a', 0, 'off'))).toBe('Klick aus')
    expect(playbackCueLabel(cue('a', 0, 'off', 'on'))).toBe('Klick aus · Ansagen an')
  })
})

const trackCue = (id: string, timeMs: number, track: TrackLevel): ShowCue => ({ id, timeMs, ...playbackCueContent({ track }) })
const at120 = clickTimeline({ bpm: 120, timeSignature: '4/4' })
// Bar 64 at 120 BPM, bar 1 at 0:00.
const BAR_64 = 63 * 2000

describe('track level, fades and mute by cue (#485)', () => {
  it('keeps the level in the payload and reads it back; nonsense is ignored', () => {
    const level: TrackLevel = { db: -6, fade: { amount: 2, unit: 'bars' } }
    expect(playbackSwitches(trackCue('a', 0, level)).track).toEqual(level)
    expect(playbackSwitches(trackCue('m', 0, { db: null })).track).toEqual({ db: null })
    expect(playbackSwitches({ payload: { track: { db: 'loud' } } }).track).toBeUndefined()
    expect(playbackSwitches({ payload: { track: { db: -3, fade: { amount: -1, unit: 'bars' } } } }).track).toEqual({ db: -3 })
    // Click and announcements are untouched by a track cue.
    expect(playbackStateAt([trackCue('m', 0, { db: null })], 1000)).toEqual({ click: true, voice: true })
  })

  it('names the level and the fade', () => {
    expect(playbackCueLabel(trackCue('a', 0, { db: -6, fade: { amount: 2, unit: 'bars' } }))).toBe('Track −6 dB in 2 Takten')
    expect(playbackCueLabel(trackCue('b', 0, { db: null }))).toBe('Track stumm')
    expect(playbackCueLabel(trackCue('c', 0, { db: 0, fade: { amount: 1, unit: 'beats' } }))).toBe('Track normal in 1 Schlag')
    expect(playbackCueLabel({ ...playbackCueContent({ click: 'off', track: { db: 3 } }) })).toBe('Klick aus · Track +3 dB')
  })

  it('"fade to −∞ over 2 bars at bar 64": full until bar 64, silent at bar 66, half-way in between (the issue\'s acceptance)', () => {
    const curve = trackLevelCurve([trackCue('f', BAR_64, { db: null, fade: { amount: 2, unit: 'bars' } })], at120)
    expect(levelAt(curve, BAR_64 - 1)).toBe(1)
    expect(levelAt(curve, BAR_64 + 2000)).toBeCloseTo(0.5, 6)
    expect(levelAt(curve, BAR_64 + 4000)).toBe(0)
    // A seek or jump past the fade: the level there, not a replay of the fade.
    expect(levelAt(curve, BAR_64 + 60_000)).toBe(0)
  })

  it('fades in bars follow the grid - at 140 BPM 2 bars are shorter', () => {
    const at140 = clickTimeline({ bpm: 140, timeSignature: '4/4' })
    expect(fadeDurationMs({ amount: 2, unit: 'bars' }, 0, at120)).toBeCloseTo(4000, 6)
    expect(fadeDurationMs({ amount: 2, unit: 'bars' }, 0, at140)).toBeCloseTo((8 * 60000) / 140, 6)
    expect(fadeDurationMs({ amount: 3, unit: 'beats' }, 250, at120)).toBeCloseTo(1500, 6) // from between two beats, too
    expect(fadeDurationMs({ amount: 750, unit: 'ms' }, 0, at120)).toBe(750)
    expect(fadeDurationMs(undefined, 0, at120)).toBe(0)
  })

  it('"at once" still ramps for 10 ms (no click); a later cue takes over from the level reached', () => {
    const curve = trackLevelCurve(
      [trackCue('down', 10_000, { db: -12, fade: { amount: 4000, unit: 'ms' } }), trackCue('mute', 12_000, { db: null }), trackCue('back', 20_000, { db: 0, fade: { amount: 1, unit: 'bars' } })],
      at120,
    )
    const halfway = 1 + (dbToGain(-12) - 1) / 2
    expect(levelAt(curve, 12_000)).toBeCloseTo(halfway, 6)
    expect(levelAt(curve, 12_005)).toBeCloseTo(halfway / 2, 6)
    expect(levelAt(curve, 12_010)).toBe(0)
    expect(levelAt(curve, 21_000)).toBeCloseTo(0.5, 6)
    expect(levelAt(curve, 22_000)).toBe(1)
  })

  it('no track cue: no curve - the engine leaves the level alone', () => {
    expect(trackLevelCurve([cue('a', 1000, 'off'), device], at120)).toEqual([])
    expect(levelAt([], 5000)).toBe(1)
  })
})
