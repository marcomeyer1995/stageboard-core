import { describe, expect, it } from 'vitest'
import { convertUltimateGuitarContent } from './ultimateGuitarFormat.js'

describe('convertUltimateGuitarContent', () => {
  it('converts a section header to a part directive', () => {
    expect(convertUltimateGuitarContent('[Verse 1]\r\nsome line')).toBe('{part: Verse 1}\nsome line')
  })

  it('splices a chord line into the lyric line beneath it at the same column', () => {
    const raw = '[tab][ch]G[/ch]   [ch]C[/ch]\nhello world[/tab]'
    // "G" at column 0, "C" at column 4 (len('G') + 3 spaces) of the untagged chord line
    // "G   C" - splice into "hello world" at columns 0 and 4.
    expect(convertUltimateGuitarContent(raw)).toBe('[G]hell[C]o world')
  })

  it('accounts for the chord name\'s own width when locating the next chord', () => {
    // Regression: a naive implementation that only counts the whitespace *between* tags
    // (not the chord name length) misplaces every chord after the first.
    const raw = '[tab][ch]F#m7[/ch]          [ch]A[/ch]\n    Today is gonna be the day[/tab]'
    expect(convertUltimateGuitarContent(raw)).toBe('[F#m7]    Today is g[A]onna be the day')
  })

  it('inlines a standalone chord-only line with no lyric beneath it', () => {
    const raw = '[Intro]\r\n[ch]F#m7[/ch] [ch]A[/ch]  [ch]Esus4[/ch]'
    expect(convertUltimateGuitarContent(raw)).toBe('{part: Intro}\n[F#m7] [A]  [Esus4]')
  })

  it('inlines a standalone chord line immediately followed by another chord line', () => {
    const raw = '[ch]D[/ch]  [ch]A[/ch]\r\n[ch]D[/ch]  [ch]A[/ch]'
    expect(convertUltimateGuitarContent(raw)).toBe('[D]  [A]\n[D]  [A]')
  })

  it('inlines a standalone chord line at end of input (no next line at all)', () => {
    expect(convertUltimateGuitarContent('[ch]D[/ch]  [ch]A[/ch]')).toBe('[D]  [A]')
  })

  it('does not treat a chord line followed by a section header as a lyric pair', () => {
    const raw = '[ch]D[/ch]  [ch]A[/ch]\n[Chorus]\nsome line'
    expect(convertUltimateGuitarContent(raw)).toBe('[D]  [A]\n{part: Chorus}\nsome line')
  })

  it('passes an ASCII tab diagram through unchanged, just losing the [tab] wrapper', () => {
    const raw = '[tab]e|-------5-2-------|\nB|-3-2-3-----------|[/tab]'
    expect(convertUltimateGuitarContent(raw)).toBe('e|-------5-2-------|\nB|-3-2-3-----------|')
  })

  it('leaves a plain lyric-only line untouched', () => {
    expect(convertUltimateGuitarContent('just some words')).toBe('just some words')
  })

  it('preserves blank lines between sections', () => {
    expect(convertUltimateGuitarContent('[Verse 1]\nline one\n\n[Chorus]\nline two')).toBe(
      '{part: Verse 1}\nline one\n\n{part: Chorus}\nline two',
    )
  })

  it('converts a full real multi-section excerpt end to end', () => {
    const raw = [
      '[Intro]',
      '[ch]F#m7[/ch] [ch]A[/ch]  [ch]Esus4[/ch]  [ch]B7sus4[/ch]',
      '',
      '[Verse 1]',
      '[tab][ch]F#m7[/ch]          [ch]A[/ch]',
      '    Today is gonna be the day[/tab]',
      '[tab]              [ch]Esus4[/ch]                  [ch]B7sus4[/ch]',
      "That they're gonna throw it back to you[/tab]",
    ].join('\r\n')

    expect(convertUltimateGuitarContent(raw)).toBe(
      [
        '{part: Intro}',
        '[F#m7] [A]  [Esus4]  [B7sus4]',
        '',
        '{part: Verse 1}',
        '[F#m7]    Today is g[A]onna be the day',
        "That they're g[Esus4]onna throw it back to y[B7sus4]ou",
      ].join('\n'),
    )
  })
})
