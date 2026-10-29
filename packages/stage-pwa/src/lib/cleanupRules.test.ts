import { describe, expect, it } from 'vitest'
import { applyCleanupRules, CLEANUP_RULES, cleanupCounts, DEFAULT_CLEANUP_RULES, type CleanupRuleId } from './cleanupRules'

const only = (id: CleanupRuleId, text: string) => applyCleanupRules(text, [id])

describe('cleanupRules (Aufräumen, Marco 2026-10-29)', () => {
  it('the defaults do what "Aufräumen" did before: one empty line at most, no trailing spaces, chord roots in capitals - lyrics untouched', () => {
    expect(applyCleanupRules('[am]hello  \n\n\n\n[c#m7]bye [bb/f]now\nam I', DEFAULT_CLEANUP_RULES)).toBe('[Am]hello\n\n[C#m7]bye [Bb/F]now\nam I')
  })

  it('section headers: no empty line after one, one empty line before one (not before the first line)', () => {
    const text = '{part: Intro}\n\n[G]la\n{part: Verse}\n\n\n[C]lu'
    expect(only('noGapAfterHeader', text)).toBe('{part: Intro}\n[G]la\n{part: Verse}\n[C]lu')
    expect(only('gapBeforeHeader', '{part: Intro}\n[G]la\n{part: Verse}\n[C]lu')).toBe('{part: Intro}\n[G]la\n\n{part: Verse}\n[C]lu')
    expect(applyCleanupRules(text, DEFAULT_CLEANUP_RULES)).toBe('{part: Intro}\n[G]la\n\n{part: Verse}\n[C]lu')
  })

  it('chord rules: spaces in brackets, spelling (H, min, M7) - never a time tag', () => {
    expect(only('chordBracketSpaces', '[00:01.00] [ Am ]Hi')).toBe('[00:01.00] [Am]Hi')
    expect(only('chordSpelling', '[H7]a [Amin]b [CM7]c [D/H]d [Hm]e')).toBe('[B7]a [Am]b [Cmaj7]c [D/B]d [Bm]e')
  })

  it('inner spaces only in lyric lines - a chord line above the lyric keeps its columns', () => {
    expect(only('innerSpaces', 'G      D\nHello    [D]world')).toBe('G      D\nHello [D]world')
  })

  it('quotes, tabs, empty edges; tab blocks are left alone by every rule', () => {
    expect(only('quotes', 'Don’t „stop“')).toBe('Don\'t "stop"')
    expect(only('tabsToSpaces', 'a\tb\n{start_of_tab}\ne|\t-3-|\n{end_of_tab}')).toBe('a b\n{start_of_tab}\ne|\t-3-|\n{end_of_tab}')
    expect(only('trimEdges', '\n\n[G]la\n\n')).toBe('[G]la')
  })

  it('counts the places per rule, each after the ticked rules before it', () => {
    const counts = cleanupCounts('[am]a  \n\n\n\n[c]b  ', DEFAULT_CLEANUP_RULES)
    expect(counts.chordRootCaps).toBe(2)
    expect(counts.trailingSpaces).toBe(2)
    expect(counts.collapseEmpty).toBe(2)
    expect(CLEANUP_RULES.every((rule) => typeof counts[rule.id] === 'number')).toBe(true)
  })
})
