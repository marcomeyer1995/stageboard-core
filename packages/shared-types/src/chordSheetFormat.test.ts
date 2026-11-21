import { describe, expect, it } from 'vitest'
import { mergeChordLines } from './chordSheetFormat.js'

describe('mergeChordLines (#605)', () => {
  it('puts chords above a lyric into it at their exact columns, also mid-word', () => {
    expect(mergeChordLines('G     D/F#\nHello World')).toBe('[G]Hello [D/F#]World')
    expect(mergeChordLines('   Am\nSunshine')).toBe('Sun[Am]shine')
  })

  it('keeps a chord line without a lyric as a line of chords; leaves ChordPro, directives and lyrics alone', () => {
    expect(mergeChordLines('| C   | F   |  x2\n\n{part: Verse}\n[G]Already inline\nAm I wrong')).toBe('| [C]   | [F]   |  x2\n\n{part: Verse}\n[G]Already inline\nAm I wrong')
  })

  it('a chord line followed by another chord line: both stay chord lines', () => {
    expect(mergeChordLines('C G\nAm F\nWords')).toBe('[C] [G]\n[Am]Wor[F]ds')
  })
})
