import { describe, expect, it } from 'vitest'
import { parseChordPro } from './chordpro'
import { prefersFlats, transposeChord, transposeKey, transposeLines } from './transposeChord'

describe('transposeChord', () => {
  it('shifts root and keeps the suffix', () => {
    expect(transposeChord('Am7', 2, false)).toBe('Bm7')
    expect(transposeChord('Csus4', 1, false)).toBe('C#sus4')
    expect(transposeChord('F#m', -2, false)).toBe('Em')
  })

  it('shifts the bass of a slash chord too', () => {
    expect(transposeChord('D/F#', 2, false)).toBe('E/G#')
    expect(transposeChord('C/E', -1, true)).toBe('B/Eb')
  })

  it('spells with flats or sharps as asked and reads either input spelling', () => {
    expect(transposeChord('G', -1, true)).toBe('Gb')
    expect(transposeChord('G', -1, false)).toBe('F#')
    expect(transposeChord('Bb', 2, false)).toBe('C')
    expect(transposeChord('Ebm', 1, false)).toBe('Em')
  })

  it('wraps around the octave in both directions', () => {
    expect(transposeChord('B', 1, false)).toBe('C')
    expect(transposeChord('C', -1, false)).toBe('B')
    expect(transposeChord('E', 14, false)).toBe('F#')
  })

  it('leaves non-chords and a zero/12 shift untouched', () => {
    expect(transposeChord('N.C.', 3, false)).toBe('N.C.')
    expect(transposeChord('x', 3, false)).toBe('x')
    expect(transposeChord('Am', 0, false)).toBe('Am')
    expect(transposeChord('Am', 12, false)).toBe('Am')
  })
})

describe('transposeKey / prefersFlats', () => {
  it('spells the sounding key for its own key', () => {
    expect(transposeKey('G', -1)).toBe('Gb')
    expect(transposeKey('G', 2)).toBe('A')
    expect(transposeKey('F#m', 3)).toBe('Am')
    expect(transposeKey('Am', -2)).toBe('Gm')
    expect(transposeKey('C', 6)).toBe('Gb')
  })

  it('falls back to the shift direction without a usable key', () => {
    expect(prefersFlats(undefined, -1)).toBe(true)
    expect(prefersFlats(undefined, 2)).toBe(false)
    expect(prefersFlats('???', -3)).toBe(true)
  })
})

describe('transposeLines', () => {
  const lines = parseChordPro('[G]Hello [C]world\nplain line')

  it('returns the same array when nothing shifts', () => {
    expect(transposeLines(lines, 0, 'G')).toBe(lines)
  })

  it('shifts only chords, keeping text and line count', () => {
    const shifted = transposeLines(lines, -1, 'G')
    expect(shifted).toHaveLength(lines.length)
    expect(shifted[0].segments.map((s) => s.chord)).toEqual(['Gb', 'B'])
    expect(shifted[0].segments.map((s) => s.text)).toEqual(lines[0].segments.map((s) => s.text))
    expect(shifted[1]).toEqual(lines[1])
  })
})
