import { describe, expect, it } from 'vitest'
import { bracketProblems, cleanupText, replaceAllText, transposeText } from './textTools'

describe('text tools (#605)', () => {
  it('transposes the text\'s own chords; time tags, directives and tab blocks stay', () => {
    const text = '{part: Verse}\n[00:12.00] [G]Hello [D/F#]world\n{start_of_tab}\ne|--[3]--|\n{end_of_tab}'
    expect(transposeText(text, 2, 'G')).toBe('{part: Verse}\n[00:12.00] [A]Hello [E/G#]world\n{start_of_tab}\ne|--[3]--|\n{end_of_tab}')
  })

  it('cleans up: one empty line at most, no trailing spaces, chord roots in capitals - lyrics untouched', () => {
    expect(cleanupText('[am]hello  \n\n\n\n[c#m7]bye [bb/f]now\nam I')).toBe('[Am]hello\n\n[C#m7]bye [Bb/F]now\nam I')
  })

  it('names the lines with an unclosed bracket', () => {
    expect(bracketProblems('[Am]fine\n[Am wrong\n{part: Verse')).toEqual([
      { line: 2, bracket: '[' },
      { line: 3, bracket: '{' },
    ])
    expect(bracketProblems('[G]all [C]good\n{c: ok}')).toEqual([])
  })

  it('replaces every occurrence literally and counts them', () => {
    expect(replaceAllText('a.b a.b', 'a.b', 'x')).toEqual({ content: 'x x', count: 2 })
    expect(replaceAllText('abc', '', 'x')).toEqual({ content: 'abc', count: 0 })
  })
})
