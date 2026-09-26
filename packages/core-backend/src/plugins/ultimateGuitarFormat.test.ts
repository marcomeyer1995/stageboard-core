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

  // Shapes found on real tab pages (2026-09-26): Blink-182 "All The Small Things", Eagles
  // "Hotel California", Cranberries "Zombie". Before, each of these left raw [ch] markup in the
  // song, and a lyric below an unrecognised chord line lost its chords entirely.

  it('inlines a bar-line chord row (| C | F |) instead of leaking [ch] tags', () => {
    const raw = '[Intro]\r\n| [ch]C[/ch]   | [ch]F[/ch]   | [ch]G[/ch]   | [ch]G[/ch]   |'
    expect(convertUltimateGuitarContent(raw)).toBe('{part: Intro}\n| [C]   | [F]   | [G]   | [G]   |')
  })

  it('splices a parenthesised chord at the column of its "(", keeping the lyric\'s chords', () => {
    const raw = "[tab]([ch]C[/ch])                         [ch]G[/ch]\r\nSay it ain't so, I will not go[/tab]"
    expect(convertUltimateGuitarContent(raw)).toBe("[C]Say it ain't so, I will not [G]go")
  })

  it('keeps a repeat mark on a standalone chord row', () => {
    const raw = '[ch]Em[/ch] [ch]C[/ch] [ch]G[/ch] [ch]D/F#[/ch]  x4'
    expect(convertUltimateGuitarContent(raw)).toBe('[Em] [C] [G] [D/F#]  x4')
  })

  it('moves a repeat mark or comment to the end of the lyric it is spliced into', () => {
    const raw = '[ch]Em[/ch]      [ch]C[/ch]    (x2)\nAnother head hangs lowly'
    expect(convertUltimateGuitarContent(raw)).toBe('[Em]Another [C]head hangs lowly  (x2)')
  })

  it('recognises chord names UG left untagged on a chord line', () => {
    const raw =
      '[ch]G[/ch]                  [ch]Gsus2[/ch]       G13sus4/E              [ch]D9[/ch]\n' +
      'And I was thinking to myself, "This could be Heaven or this could be Hell"'
    expect(convertUltimateGuitarContent(raw)).toBe(
      '[G]And I was thinking [Gsus2]to myself, "[G13sus4/E]This could be Heaven or[D9] this could be Hell"',
    )
  })

  it('never splices chords into a following chord line (was "[Am][ch[E7]]F[/..." garbage)', () => {
    const raw = [
      '[ch]Am[/ch] [ch]E7[/ch]  [ch]Gsus2[/ch] [ch]D9[/ch]',
      '[ch]F[/ch]  [ch]C[/ch]   [ch]Dm7[/ch]   Em7add#5',
    ].join('\n')
    expect(convertUltimateGuitarContent(raw)).toBe('[Am] [E7]  [Gsus2] [D9]\n[F]  [C]   [Dm7]   [Em7add#5]')
  })

  it('keeps a parenthetical comment on a standalone chord row', () => {
    expect(convertUltimateGuitarContent('[ch]Dm[/ch]     [ch]E7[/ch]  (Cesura)')).toBe('[Dm]     [E7]  (Cesura)')
  })

  it('keeps N.C. as a chord symbol', () => {
    expect(convertUltimateGuitarContent('[ch]G[/ch]   N.C.\nstop here')).toBe('[G]stop[N.C.] here')
  })

  it('does not take ordinary words for untagged chords - a real text line with a tag stays text', () => {
    // "Be" and "Go" start with a note letter but are not chords, so this is not a chord line;
    // the embedded tag is still reduced to [X] rather than leaked.
    const raw = 'Be quiet [ch]Am[/ch] Go\nnext line'
    expect(convertUltimateGuitarContent(raw)).toBe('Be quiet [Am] Go\nnext line')
  })

  it('keeps a note after a section label as a comment instead of turning the label into a chord', () => {
    expect(convertUltimateGuitarContent('[Chorus] (x4)\nsome line')).toBe('{part: Chorus}\n{c: (x4)}\nsome line')
    expect(convertUltimateGuitarContent('[Intro] (G in riff is really G5)')).toBe('{part: Intro}\n{c: (G in riff is really G5)}')
    expect(convertUltimateGuitarContent('[Spoken]      [Ike singing]')).toBe('{part: Spoken}\n{c: Ike singing}')
  })

  it('leaves a lyric line that merely starts with a bracketed word as a lyric, brackets neutralised', () => {
    // Kept as a lyric, not demoted to a comment - and "[Ike]" must not become a chord.
    expect(convertUltimateGuitarContent('[Ike] Left a good job in the city')).toBe('(Ike) Left a good job in the city')
  })

  it('turns square brackets in lyric text into parentheses before splicing chords in', () => {
    // Real (Golden Earring "Radar Love"): was "[NC][Radar [F#m7]Love].(Unspoken)".
    const raw = '[tab]NC     [ch]F#m7[/ch]\n[Radar Love].(Unspoken)[/tab]'
    expect(convertUltimateGuitarContent(raw)).toBe('[NC](Radar [F#m7]Love).(Unspoken)')
  })
})
