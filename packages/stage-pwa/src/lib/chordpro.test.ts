import { describe, expect, it } from 'vitest'
import { parseChordPro } from './chordpro'

describe('parseChordPro', () => {
  it('parses a time tag and inline chords', () => {
    const [line] = parseChordPro(
      "[01:14.50] I shot the [G] Sheriff, but I didn't shoot the [C] deputy.",
    )
    expect(line.timeMs).toBe(74500)
    expect(line.segments).toEqual([
      { chord: null, text: 'I shot the ' },
      { chord: 'G', text: " Sheriff, but I didn't shoot the " },
      { chord: 'C', text: ' deputy.' },
    ])
  })

  it('handles a line with no time tag', () => {
    const [line] = parseChordPro('Just a [Am] plain line')
    expect(line.timeMs).toBeNull()
    expect(line.segments).toEqual([
      { chord: null, text: 'Just a ' },
      { chord: 'Am', text: ' plain line' },
    ])
  })

  it('handles a line with no chords at all', () => {
    const [line] = parseChordPro('No chords here')
    expect(line.segments).toEqual([{ chord: null, text: 'No chords here' }])
  })

  it('handles back-to-back chords with no text between them', () => {
    const [line] = parseChordPro('[G][C]word')
    expect(line.segments).toEqual([
      { chord: 'G', text: '' },
      { chord: 'C', text: 'word' },
    ])
  })

  it('skips blank lines', () => {
    const lines = parseChordPro('First line\n\n\nSecond line')
    expect(lines).toHaveLength(2)
  })

  it('parses multiple lines independently', () => {
    const lines = parseChordPro('[00:00.00] Verse one [G]\n[00:04.20] Verse two [C]')
    expect(lines).toHaveLength(2)
    expect(lines[0].timeMs).toBe(0)
    expect(lines[1].timeMs).toBe(4200)
  })
})
