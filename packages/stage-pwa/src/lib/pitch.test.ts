import { describe, expect, it } from 'vitest'
import { chartTuning, parseTuning, playTuning, stageTuning, soundingKey, tuningLabel, unrecognisedTuningText, variantChordShift } from './pitch'

const EB = { semitones: -1 }

describe('pitch - tuning and stored transpose (Marco, 2026-10-18)', () => {
  it('plays the variant Stimmung, else standard - never a band-wide one', () => {
    expect(playTuning({ tuningSpec: EB })).toEqual(EB)
    expect(playTuning({})).toEqual({ semitones: 0 })
    expect(playTuning(null)).toEqual({ semitones: 0 })
  })

  it('reads an old free-text tuning as what the chart is written for', () => {
    expect(chartTuning({ tuning: 'Eb Ab Db Gb Bb Eb' })).toEqual(EB)
    expect(chartTuning({ tuning: 'Eb', chartTuning: { semitones: 0 } })).toEqual({ semitones: 0 })
    expect(chartTuning({ tuning: 'Nashville' })).toEqual({ semitones: 0 })
  })

  it('shifts the grips by transpose minus the played tuning', () => {
    // Guitar in Eb, song two lower than the original: the tuning gives one, grab one lower.
    expect(variantChordShift({ transpose: -2, tuningSpec: EB })).toBe(-1)
    // Guitar in Eb, song as the original: grab one higher.
    expect(variantChordShift({ tuningSpec: EB })).toBe(1)
    // Guitar in Eb, song a half step lower: the written chords.
    expect(variantChordShift({ transpose: -1, tuningSpec: EB })).toBe(0)
    // Standard tuning: the transpose itself.
    expect(variantChordShift({ transpose: -2 })).toBe(-2)
    // Drop and open tunings don't move the chords.
    expect(variantChordShift({ tuningSpec: { semitones: 0, drop: true } })).toBe(0)
    expect(variantChordShift({ tuningSpec: { semitones: 0, open: 'open-g' } })).toBe(0)
  })

  it('adds back the tuning the chart is written for', () => {
    // A chart written for Eb, played on a guitar in Eb, sounding like the original: as written.
    expect(variantChordShift({ chartTuning: EB, tuningSpec: EB })).toBe(0)
    // The same chart on a standard-tuned guitar: one lower to sound like the original.
    expect(variantChordShift({ chartTuning: EB })).toBe(-1)
    // Imported free text counts the same way.
    expect(variantChordShift({ tuning: 'Eb Ab Db Gb Bb Eb', tuningSpec: EB })).toBe(0)
  })

  it('tunes for the chart\'s Drop / open layout at the played offset', () => {
    expect(stageTuning({ chartTuning: { semitones: 0, drop: true }, tuningSpec: EB })).toEqual({ semitones: -1, drop: true })
    expect(stageTuning({ tuning: 'Open G' })).toEqual({ semitones: 0, open: 'open-g' })
    expect(stageTuning({ chartTuning: { semitones: 0, drop: true }, tuningSpec: { semitones: 0, open: 'dadgad' } })).toEqual({ semitones: 0, open: 'dadgad' })
    expect(stageTuning({ tuningSpec: EB })).toEqual(EB)
  })

  it('names the sounding key and the tuning', () => {
    expect(soundingKey({ key: 'G', transpose: -2 })).toBe('F')
    expect(soundingKey({ key: 'Am' })).toBe('Am')
    expect(soundingKey({})).toBeUndefined()
    expect(tuningLabel({ semitones: 0 })).toBe('Standard')
    expect(tuningLabel(EB)).toBe('½ Ton tiefer (Eb)')
    expect(tuningLabel({ semitones: -2 })).toBe('1 Ton tiefer (D)')
    expect(tuningLabel({ semitones: 0, drop: true })).toBe('Drop D')
    expect(tuningLabel({ semitones: -1, drop: true })).toBe('Drop C#')
    expect(tuningLabel({ semitones: 0, open: 'dadgad' })).toBe('DADGAD')
  })
})

describe('parseTuning - imports and old free text', () => {
  it.each([
    ['', { semitones: 0 }],
    ['E A D G B E', { semitones: 0 }],
    ['EADGBe', { semitones: 0 }],
    ['Standard', { semitones: 0 }],
    ['Eb Ab Db Gb Bb Eb', EB],
    ['D# G# C# F# A# D#', EB],
    ['Half step down', EB],
    ['Eb Standard', EB],
    ['D G C F A D', { semitones: -2 }],
    ['Whole step down', { semitones: -2 }],
    ['D Standard', { semitones: -2 }],
    ['Drop D', { semitones: 0, drop: true }],
    ['D A D G B E', { semitones: 0, drop: true }],
    ['Drop C#', { semitones: -1, drop: true }],
    ['C# G# C# F# A# D#', { semitones: -1, drop: true }],
    ['Drop C', { semitones: -2, drop: true }],
    ['DADGAD', { semitones: 0, open: 'dadgad' }],
    ['Open G', { semitones: 0, open: 'open-g' }],
    ['D G D G B D', { semitones: 0, open: 'open-g' }],
    ['E B E G# B E', { semitones: 0, open: 'open-e' }],
  ])('%s', (text, expected) => {
    expect(parseTuning(text)).toEqual(expected)
  })

  it('returns null for text it cannot read, and that text is kept for display', () => {
    expect(parseTuning('Nashville')).toBeNull()
    expect(unrecognisedTuningText({ tuning: 'Nashville' })).toBe('Nashville')
    expect(unrecognisedTuningText({ tuning: 'Drop D' })).toBeNull()
    expect(unrecognisedTuningText({ tuning: 'Nashville', chartTuning: { semitones: 0 } })).toBeNull()
  })
})
