import { describe, expect, it } from 'vitest'
import { CHORD_QUALITIES, lookUpChord, noteToPitchClass, rootName } from './chordReference'

describe('lookUpChord', () => {
  it('gives the notes, intervals and symbol of a chord', () => {
    const chord = lookUpChord(0, 'maj7', 'sharp')
    expect(chord.symbol).toBe('Cmaj7')
    expect(chord.notes).toEqual(['C', 'E', 'G', 'B'])
    expect(chord.intervals).toEqual(['1', '3', '5', '7'])
    expect(chord.semitones).toEqual([0, 4, 7, 11])
  })

  it('reads flattened tones as chord-chart numbers', () => {
    expect(lookUpChord(0, 'min', 'sharp').intervals).toEqual(['1', 'b3', '5'])
    expect(lookUpChord(0, '7', 'sharp').intervals).toEqual(['1', '3', '5', 'b7'])
    expect(lookUpChord(0, 'dim', 'sharp').intervals).toEqual(['1', 'b3', 'b5'])
    expect(lookUpChord(0, 'aug', 'sharp').intervals).toEqual(['1', '3', '#5'])
  })

  it('spells the root and the chord for the chosen naming', () => {
    expect(lookUpChord(10, 'm7', 'flat').notes).toEqual(['Bb', 'Db', 'F', 'Ab'])
    expect(lookUpChord(10, 'm7', 'sharp').notes).toEqual(['A#', 'C#', 'E#', 'G#'])
    expect(lookUpChord(6, 'maj', 'flat').symbol).toBe('Gb')
  })

  it('stacks the keyboard positions ascending from the root, wrapping past the octave', () => {
    // Bb major: Bb D F -> 0, 4, 7 above the root regardless of which pitch classes wrap around C.
    expect(lookUpChord(10, 'maj', 'flat').semitones).toEqual([0, 4, 7])
    expect(lookUpChord(7, 'sus4', 'sharp').semitones).toEqual([0, 5, 7])
  })

  it('resolves every root/quality combination to a non-empty chord', () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of CHORD_QUALITIES) {
        const chord = lookUpChord(root, quality.id, 'sharp')
        expect(chord.notes.length).toBeGreaterThanOrEqual(2)
        expect(chord.pitchClasses).toContain(root)
        expect(chord.semitones).toHaveLength(chord.notes.length)
      }
    }
  })
})

describe('noteToPitchClass / rootName', () => {
  it('maps note names, including flats and sharps, onto 0-11', () => {
    expect(noteToPitchClass('C')).toBe(0)
    expect(noteToPitchClass('Bb')).toBe(10)
    expect(noteToPitchClass('F#')).toBe(6)
    expect(noteToPitchClass('Cb')).toBe(11)
    expect(noteToPitchClass('B#')).toBe(0)
  })

  it('names a pitch class by preference', () => {
    expect(rootName(1, 'sharp')).toBe('C#')
    expect(rootName(1, 'flat')).toBe('Db')
    expect(rootName(13, 'sharp')).toBe('C#')
  })
})
