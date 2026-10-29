import { describe, expect, it } from 'vitest'
import { bracketProblems, transposeText } from './textTools'

describe('text tools (#605)', () => {
  it('transposes the text\'s own chords; time tags, directives and tab blocks stay', () => {
    const text = '{part: Verse}\n[00:12.00] [G]Hello [D/F#]world\n{start_of_tab}\ne|--[3]--|\n{end_of_tab}'
    expect(transposeText(text, 2, 'G')).toBe('{part: Verse}\n[00:12.00] [A]Hello [E/G#]world\n{start_of_tab}\ne|--[3]--|\n{end_of_tab}')
  })

  it('names the lines with an unclosed bracket', () => {
    expect(bracketProblems('[Am]fine\n[Am wrong\n{part: Verse')).toEqual([
      { line: 2, bracket: '[' },
      { line: 3, bracket: '{' },
    ])
    expect(bracketProblems('[G]all [C]good\n{c: ok}')).toEqual([])
  })
})
