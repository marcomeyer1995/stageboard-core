import { describe, expect, it } from 'vitest'
import { applyTextFixes, changedLines, textFixOffers } from './variantTextFix'

const variant = (id: string, chordProContent: string) => ({ id, label: id.toUpperCase(), chordProContent })

describe('variantTextFix (#600)', () => {
  it('offers a typo fix to the variants that have the old line, and keeps their own timing tag', () => {
    const before = '[00:01.00] [G]Hallo Wlet\n[00:05.00] zweite Zeile'
    const after = '[00:01.00] [G]Hallo Welt\n[00:05.00] zweite Zeile'
    const b = variant('b', '[00:03.20] [G]Hallo Wlet\n[00:08.00] zweite Zeile')
    const c = variant('c', '[00:02.00] [G]Hallo Welt, anders\nzweite Zeile')
    const offers = textFixOffers(before, after, [b, c])
    expect(offers).toEqual([{ before: '[G]Hallo Wlet', after: '[G]Hallo Welt', targets: [{ variantId: 'b', variantLabel: 'B', lineIndex: 0 }] }])
    expect(applyTextFixes(b.chordProContent, [{ lineIndex: 0, after: '[G]Hallo Welt' }])).toBe('[00:03.20] [G]Hallo Welt\n[00:08.00] zweite Zeile')
  })

  it('offers nothing when no other variant has the line, and nothing for a changed timing only', () => {
    expect(textFixOffers('Hallo Wlet', 'Hallo Welt', [variant('b', 'ganz anders')])).toEqual([])
    expect(changedLines('[00:01.00] Hallo', '[00:04.50] Hallo')).toEqual([])
  })

  it('matches a repeated line by occurrence - the 2nd chorus line changed is the 2nd there, never another', () => {
    const before = 'Chorus\nStrophe\nChorus\nStrophe\nChorus'
    const after = 'Chorus\nStrophe\nChorus!\nStrophe\nChorus'
    const offers = textFixOffers(before, after, [variant('b', '[00:01.00] Chorus\n[00:09.00] Chorus\n[00:20.00] Chorus'), variant('short', 'Chorus')])
    expect(offers).toEqual([{ before: 'Chorus', after: 'Chorus!', targets: [{ variantId: 'b', variantLabel: 'B', lineIndex: 1 }] }])
  })

  it('pairs replaced lines in order and ignores lines that were only added or removed', () => {
    expect(changedLines('a\nb\nc\nd', 'a\nB\nC\nd\nneu')).toEqual([
      { oldIndex: 1, before: 'b', after: 'B' },
      { oldIndex: 2, before: 'c', after: 'C' },
    ])
    expect(changedLines('a\nb\nc', 'a\nc')).toEqual([])
  })
})
