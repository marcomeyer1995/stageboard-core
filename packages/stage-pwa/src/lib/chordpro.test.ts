import { describe, expect, it } from 'vitest'
import { currentLineIndex, formatTimeTag, parseChordPro, setLineTimeTag } from './chordpro'

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

describe('formatTimeTag', () => {
  it('formats milliseconds as [mm:ss.ss]', () => {
    expect(formatTimeTag(74500)).toBe('[01:14.50]')
    expect(formatTimeTag(0)).toBe('[00:00.00]')
    expect(formatTimeTag(4200)).toBe('[00:04.20]')
  })

  it('clamps negative values to zero', () => {
    expect(formatTimeTag(-500)).toBe('[00:00.00]')
  })

  it('round-trips through parseChordPro', () => {
    const [line] = parseChordPro(`${formatTimeTag(93250)} some lyric`)
    expect(line.timeMs).toBe(93250)
  })
})

describe('setLineTimeTag', () => {
  it('prepends a time tag to an untagged line', () => {
    expect(setLineTimeTag('Just a [Am] plain line', 4200)).toBe(
      '[00:04.20] Just a [Am] plain line',
    )
  })

  it('replaces an existing time tag', () => {
    expect(setLineTimeTag('[00:00.00] Verse one', 15000)).toBe('[00:15.00] Verse one')
  })
})

describe('currentLineIndex', () => {
  const lines = parseChordPro('[00:00.00] Verse one\n[00:05.00] Verse two\n[00:10.00] Chorus')

  it('picks the last line whose time has passed', () => {
    expect(currentLineIndex(lines, 0)).toBe(0)
    expect(currentLineIndex(lines, 4999)).toBe(0)
    expect(currentLineIndex(lines, 5000)).toBe(1)
    expect(currentLineIndex(lines, 12000)).toBe(2)
  })

  it('falls back to the first line when nothing has timecodes', () => {
    const untimed = parseChordPro('Verse one\nVerse two')
    expect(currentLineIndex(untimed, 999999)).toBe(0)
  })
})
