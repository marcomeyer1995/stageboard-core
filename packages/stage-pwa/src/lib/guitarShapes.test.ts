import { describe, expect, it } from 'vitest'
import { CHORD_QUALITIES, lookUpChord, type ChordQualityId } from './chordReference'
import { bassPitchClass, guitarShapeFor, soundedPitchClasses } from './guitarShapes'

/** The chord tones a shape may leave out: a fifth is commonly dropped from 6th/7th chords. */
const OMITTABLE_INTERVALS = new Set(['5'])

describe('guitarShapeFor - every shape is checked against the chord tonal computes', () => {
  for (let root = 0; root < 12; root++) {
    for (const quality of CHORD_QUALITIES) {
      it(`${lookUpChord(root, quality.id, 'sharp').symbol} sounds only chord tones, with the root in the bass`, () => {
        const shape = guitarShapeFor(root, quality.id)
        expect(shape, 'a shape exists for every root and quality').not.toBeNull()
        if (!shape) return

        const chord = lookUpChord(root, quality.id, 'sharp')
        const sounded = new Set(soundedPitchClasses(shape.frets))
        // Nothing sounded may be a wrong note...
        for (const pitchClass of sounded) expect(chord.pitchClasses).toContain(pitchClass)
        // ...every characteristic tone must be there (only a plain fifth may be missing)...
        chord.pitchClasses.forEach((pitchClass, index) => {
          if (!OMITTABLE_INTERVALS.has(chord.intervals[index])) expect(sounded).toContain(pitchClass)
        })
        // ...and the bass note is the root.
        expect(bassPitchClass(shape.frets)).toBe(root)
      })
    }
  }
})

describe('guitarShapeFor - fingering details', () => {
  it('uses the familiar open shapes', () => {
    expect(guitarShapeFor(0, 'maj')?.frets).toEqual([null, 3, 2, 0, 1, 0]) // C
    expect(guitarShapeFor(7, 'maj')?.frets).toEqual([3, 2, 0, 0, 0, 3]) // G
    expect(guitarShapeFor(2, 'min')?.frets).toEqual([null, null, 0, 2, 3, 1]) // Dm
    expect(guitarShapeFor(9, 'maj')?.frets).toEqual([null, 0, 2, 2, 2, 0]) // A
    expect(guitarShapeFor(4, 'min')?.frets).toEqual([0, 2, 2, 0, 0, 0]) // Em
  })

  it('falls back to a barre shape where there is no open one, at the lowest position', () => {
    expect(guitarShapeFor(5, 'maj')?.frets).toEqual([1, 3, 3, 2, 1, 1]) // F: E-form at fret 1
    expect(guitarShapeFor(10, 'maj')?.frets).toEqual([null, 1, 3, 3, 3, 1]) // Bb: A-form at fret 1
  })

  it('shows the nut for a first-position shape and a labelled window for a higher one', () => {
    expect(guitarShapeFor(0, 'maj')?.baseFret).toBe(1)
    expect(guitarShapeFor(6, 'maj')?.baseFret).toBe(1) // F#: 2 4 4 3 2 2 still fits frets 1-4
    expect(guitarShapeFor(8, 'maj')?.baseFret).toBe(4) // Ab/G#: 4 6 6 5 4 4
  })

  it('never returns a fret outside the neck', () => {
    for (let root = 0; root < 12; root++) {
      for (const quality of CHORD_QUALITIES) {
        for (const fret of guitarShapeFor(root, quality.id as ChordQualityId)?.frets ?? []) {
          if (fret !== null) expect(fret).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })
})
