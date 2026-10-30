import { describe, expect, it } from 'vitest'
import { explainPattern, findMatches, replaceOne, replaceText, type SearchMode } from './textReplace'

const opts = (find: string, replacement: string, mode: SearchMode = 'normal', caseSensitive = true, wholeWord = false) => ({ find, replacement, mode, caseSensitive, wholeWord })

describe('textReplace (Suchen & Ersetzen like Notepad++, Marco 2026-10-29)', () => {
  it('normal: literally - dots and dollars mean themselves - with case and whole words', () => {
    expect(replaceText('a.b a.b axb', opts('a.b', '$1'))).toEqual({ content: '$1 $1 axb', count: 2 })
    expect(replaceText('Chorus chorus', opts('chorus', 'X', 'normal', false))).toEqual({ content: 'X X', count: 2 })
    expect(replaceText('Am Ame Lärm am', opts('am', 'X', 'normal', false, true))).toEqual({ content: 'X Ame Lärm X', count: 2 })
  })

  it('extended: \\n and \\t in search and replacement', () => {
    expect(replaceText('a\n\n\nb', opts('\\n\\n\\n', '\\n\\n', 'extended'))).toEqual({ content: 'a\n\nb', count: 1 })
    expect(replaceText('a b', opts(' ', '\\t', 'extended'))).toEqual({ content: 'a\tb', count: 1 })
  })

  it('regular expressions with groups $1, named groups, $& and $$ - ^ and $ per line', () => {
    expect(replaceText('[Am]  la\n[G]   lu', opts('^\\[(\\w+)\\]\\s+', '[$1]', 'regex'))).toEqual({ content: '[Am]la\n[G]lu', count: 2 })
    expect(replaceText('Verse 1', opts('(?<name>\\w+) (?<n>\\d)', '$<n>. $<name>', 'regex'))).toEqual({ content: '1. Verse', count: 1 })
    expect(replaceText('a', opts('a', '[$&] $$', 'regex'))).toEqual({ content: '[a] $', count: 1 })
    expect('error' in replaceText('a', opts('(', 'x', 'regex'))).toBe(true)
  })

  it('finds matches with their line, only within the marked lines when asked, and replaces one at a time', () => {
    const text = 'la\nla la\nla'
    const all = findMatches(text, opts('la', 'LA'))
    expect(Array.isArray(all) && all.map((m) => [m.start, m.line])).toEqual([[0, 1], [3, 2], [6, 2], [9, 3]])
    const marked = findMatches(text, opts('la', 'LA'), 3, 8)
    expect(Array.isArray(marked) && marked.length).toBe(2)
    expect(Array.isArray(all) && replaceOne(text, all[1]!)).toBe('la\nLA la\nla')
    // An empty match (^ alone) never loops.
    const starts = findMatches(text, opts('^', '> ', 'regex'))
    expect(Array.isArray(starts) && starts.length).toBe(3)
  })

  it('explains a pattern in words', () => {
    expect(explainPattern('^\\[(\\w+)\\]')).toEqual([
      'Zeilenanfang',
      'der Text „[“',
      'Anfang Gruppe 1 ($1)',
      'ein Buchstabe, eine Ziffer oder _, einmal oder öfter',
      'Ende der Gruppe',
      'der Text „]“',
    ])
    expect(explainPattern('ab+')).toEqual(['der Text „a“', 'das Zeichen „b“, einmal oder öfter'])
    expect(explainPattern('\\d{2}')).toEqual(['eine Ziffer, genau 2-mal'])
  })
})
