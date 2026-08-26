import { describe, expect, it } from 'vitest'
import { noteFromFrequency } from './noteFromFrequency'

describe('noteFromFrequency', () => {
  it('identifies A4 (440 Hz) exactly', () => {
    expect(noteFromFrequency(440)).toEqual({ name: 'A', octave: 4, cents: 0 })
  })

  it('identifies middle C (C4, ~261.63 Hz)', () => {
    expect(noteFromFrequency(261.6256)).toEqual({ name: 'C', octave: 4, cents: 0 })
  })

  it('identifies A2 (110 Hz)', () => {
    expect(noteFromFrequency(110)).toEqual({ name: 'A', octave: 2, cents: 0 })
  })

  it('reports a sharp deviation as positive cents', () => {
    // A4 slightly sharp - about halfway to A#4.
    const note = noteFromFrequency(440 * Math.pow(2, 0.25 / 12))
    expect(note.name).toBe('A')
    expect(note.octave).toBe(4)
    expect(note.cents).toBeCloseTo(25, 0)
  })

  it('reports a flat deviation as negative cents', () => {
    const note = noteFromFrequency(440 * Math.pow(2, -0.25 / 12))
    expect(note.name).toBe('A')
    expect(note.cents).toBeCloseTo(-25, 0)
  })

  it('rolls over into the next octave at B -> C', () => {
    // Just above B4 should round up to C5, not stay at B4.
    const note = noteFromFrequency(493.88 * Math.pow(2, 0.6 / 12))
    expect(note.name).toBe('C')
    expect(note.octave).toBe(5)
  })

  it('spells an out-of-key note as flat when asked', () => {
    // The note between F and G: F# by default, Gb when naming is 'flat'. A4 down 3
    // semitones (A -> G# -> G -> F#) lands there.
    const fSharp = 440 * Math.pow(2, -3 / 12)
    expect(noteFromFrequency(fSharp).name).toBe('F#')
    expect(noteFromFrequency(fSharp, { naming: 'flat' }).name).toBe('Gb')
  })

  it('measures against a custom reference frequency instead of 440 Hz', () => {
    // If the band tunes to A4 = 442 Hz, 442 Hz itself must read as dead-on-pitch A4.
    expect(noteFromFrequency(442, { referenceFrequency: 442 })).toEqual({
      name: 'A',
      octave: 4,
      cents: 0,
    })
    // ...and against the *default* 440 reference, that same 442 Hz reads slightly sharp.
    expect(noteFromFrequency(442).cents).toBeGreaterThan(0)
  })
})
