import { describe, expect, it } from 'vitest'
import { explainPattern, previewChanges, replaceText } from './textReplace'

const opts = (find: string, replacement: string, regex = false, caseSensitive = true) => ({ find, replacement, regex, caseSensitive })

describe('textReplace (Suchen & Ersetzen, Marco 2026-10-29)', () => {
  it('literally by default - dots and dollars mean themselves - and counts', () => {
    expect(replaceText('a.b a.b axb', opts('a.b', '$1'))).toEqual({ content: '$1 $1 axb', count: 2 })
    expect(replaceText('Chorus chorus', opts('chorus', 'X', false, false))).toEqual({ content: 'X X', count: 2 })
  })

  it('regular expressions with groups $1, named groups, $& and $$ - ^ and $ per line', () => {
    expect(replaceText('[Am]  la\n[G]   lu', opts('^\\[(\\w+)\\]\\s+', '[$1]', true))).toEqual({ content: '[Am]la\n[G]lu', count: 2 })
    expect(replaceText('Verse 1', opts('(?<name>\\w+) (?<n>\\d)', '$<n>. $<name>', true))).toEqual({ content: '1. Verse', count: 1 })
    expect(replaceText('a', opts('a', '[$&] $$', true))).toEqual({ content: '[a] $', count: 1 })
  })

  it('an invalid pattern says why instead of doing anything', () => {
    expect(replaceText('a', opts('(', 'x', true))).toEqual({ error: expect.stringContaining('') })
    expect('error' in replaceText('a', opts('(', 'x', true))).toBe(true)
  })

  it('previews the changed lines, before and after', () => {
    expect(previewChanges('a\nb\nc', 'a\nB\nc').lines).toEqual([{ line: 2, before: 'b', after: 'B' }])
    expect(previewChanges('a\nb\nc', 'a\nc').lines).toEqual([{ line: 2, before: 'b', after: '' }])
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
