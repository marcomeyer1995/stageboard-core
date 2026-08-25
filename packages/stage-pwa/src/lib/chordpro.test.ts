import { describe, expect, it } from 'vitest'
import {
  buildPages,
  currentLineIndex,
  currentPageIndex,
  formatTimeTag,
  nextSectionIndex,
  parseChordPro,
  setLineTimeTag,
} from './chordpro'

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

describe('song parts', () => {
  it('tags lines with the label of the part they follow', () => {
    const lines = parseChordPro('{part: Verse 1}\nOne\nTwo\n{part: Chorus}\nThree')
    expect(lines.map((line) => line.partLabel)).toEqual(['Verse 1', 'Verse 1', 'Chorus'])
    expect(lines.map((line) => line.partIndex)).toEqual([0, 0, 1])
  })

  it('emits no line for the directive itself', () => {
    const lines = parseChordPro('{part: Chorus}\nOnly lyric')
    expect(lines).toHaveLength(1)
    expect(lines[0].segments).toEqual([{ chord: null, text: 'Only lyric' }])
  })

  it('leaves lines before the first directive unlabelled', () => {
    const lines = parseChordPro('Intro line\n{part: Verse}\nVerse line')
    expect(lines[0].partLabel).toBeNull()
    expect(lines[0].partIndex).toBe(0)
    expect(lines[1].partIndex).toBe(1)
  })

  it('accepts ChordPro standard section directives', () => {
    const lines = parseChordPro('{soc}\nHook\n{start_of_verse: Verse 2}\nStory')
    expect(lines.map((line) => line.partLabel)).toEqual(['Chorus', 'Verse 2'])
  })

  it('closes a part on an end directive', () => {
    const lines = parseChordPro('{soc}\nHook\n{eoc}\nOutro noodling')
    expect(lines.map((line) => line.partLabel)).toEqual(['Chorus', null])
    expect(lines[1].partIndex).toBe(1)
  })

  it('does not leave an empty part behind for back-to-back directives', () => {
    const lines = parseChordPro('{part: Ignored}\n{part: Chorus}\nHook')
    expect(lines[0].partLabel).toBe('Chorus')
    expect(lines[0].partIndex).toBe(0)
  })

  it('treats unknown directives as ordinary text', () => {
    const lines = parseChordPro('{title: Sweet Home}')
    expect(lines).toHaveLength(1)
    expect(lines[0].partLabel).toBeNull()
    expect(lines[0].segments).toEqual([{ chord: null, text: '{title: Sweet Home}' }])
  })

  it('keeps timecodes and chords working inside a part', () => {
    const [line] = parseChordPro('{part: Chorus}\n[00:05.00] Sing [G] along')
    expect(line.timeMs).toBe(5000)
    expect(line.partLabel).toBe('Chorus')
  })
})

describe('buildPages', () => {
  it('makes one page per song part', () => {
    const lines = parseChordPro('{part: Verse}\nOne\nTwo\n{part: Chorus}\nThree')
    expect(buildPages(lines)).toEqual([
      { label: 'Verse', startIndex: 0, endIndex: 2 },
      { label: 'Chorus', startIndex: 2, endIndex: 3 },
    ])
  })

  it('keeps unlabelled lead-in lines as their own page', () => {
    const lines = parseChordPro('Intro\n{part: Verse}\nOne')
    expect(buildPages(lines)).toEqual([
      { label: null, startIndex: 0, endIndex: 1 },
      { label: 'Verse', startIndex: 1, endIndex: 2 },
    ])
  })

  it('falls back to fixed-size chunks when the song defines no parts', () => {
    const lines = parseChordPro('a\nb\nc\nd\ne')
    expect(buildPages(lines, 2)).toEqual([
      { label: null, startIndex: 0, endIndex: 2 },
      { label: null, startIndex: 2, endIndex: 4 },
      { label: null, startIndex: 4, endIndex: 5 },
    ])
  })

  it('returns no pages for an empty song', () => {
    expect(buildPages(parseChordPro(''))).toEqual([])
  })
})

describe('currentPageIndex', () => {
  const pages = buildPages(parseChordPro('{part: Verse}\nOne\nTwo\n{part: Chorus}\nThree'))

  it('finds the page holding the active line', () => {
    expect(currentPageIndex(pages, 0)).toBe(0)
    expect(currentPageIndex(pages, 1)).toBe(0)
    expect(currentPageIndex(pages, 2)).toBe(1)
  })

  it('falls back to the first page for an out-of-range line', () => {
    expect(currentPageIndex(pages, 99)).toBe(0)
    expect(currentPageIndex([], 0)).toBe(0)
  })
})

describe('nextSectionIndex', () => {
  it('jumps to the next part, not the next line', () => {
    const lines = parseChordPro(
      '{part: Verse}\n[00:00.00] One\n[00:05.00] Two\n{part: Chorus}\n[00:10.00] Hook',
    )
    expect(nextSectionIndex(lines, 0)).toBe(2)
    expect(nextSectionIndex(lines, 1)).toBe(2)
  })

  it('skips untimed lines at the start of the next part', () => {
    const lines = parseChordPro(
      '{part: Verse}\n[00:00.00] One\n{part: Chorus}\nUntimed\n[00:10.00] Hook',
    )
    expect(nextSectionIndex(lines, 0)).toBe(2)
  })

  it('falls back to the next line when the song defines no parts', () => {
    const lines = parseChordPro('[00:00.00] One\n[00:05.00] Two')
    expect(nextSectionIndex(lines, 0)).toBe(1)
  })

  it('returns null at the end of the song', () => {
    const withParts = parseChordPro('{part: Verse}\n[00:00.00] One\n[00:05.00] Two')
    expect(nextSectionIndex(withParts, 1)).toBeNull()
    const plain = parseChordPro('[00:00.00] Only')
    expect(nextSectionIndex(plain, 0)).toBeNull()
    expect(nextSectionIndex(plain, 99)).toBeNull()
  })

  it('returns null when no later line carries a timecode', () => {
    const lines = parseChordPro('[00:00.00] One\nUntimed')
    expect(nextSectionIndex(lines, 0)).toBeNull()
  })
})
