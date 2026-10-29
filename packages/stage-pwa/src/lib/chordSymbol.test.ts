import { describe, expect, it } from 'vitest'
import { parseChordSymbol } from './chordSymbol'

describe('parseChordSymbol (#609)', () => {
  it('reads root, notes and the shape quality of a common chord', () => {
    expect(parseChordSymbol('F#m7')).toMatchObject({ rootPitchClass: 6, notes: ['F#', 'A', 'C#', 'E'], semitones: [0, 3, 7, 10], qualityId: 'm7', bass: null })
    expect(parseChordSymbol('Bb')).toMatchObject({ rootPitchClass: 10, qualityId: 'maj' })
    expect(parseChordSymbol('Asus')).toMatchObject({ qualityId: 'sus4' })
  })

  it('still gives notes for chords without a guitar shape, and keeps a slash chord bass', () => {
    expect(parseChordSymbol('C9')).toMatchObject({ notes: ['C', 'E', 'G', 'Bb', 'D'], semitones: [0, 4, 7, 10, 14], qualityId: null })
    expect(parseChordSymbol('D/F#')).toMatchObject({ rootPitchClass: 2, bass: 'F#', qualityId: 'maj' })
  })

  it('reads German H as B, and nothing for what is no chord', () => {
    expect(parseChordSymbol('H7')).toMatchObject({ rootPitchClass: 11, qualityId: '7' })
    expect(parseChordSymbol('N.C.')).toBeNull()
    expect(parseChordSymbol('')).toBeNull()
  })
})
