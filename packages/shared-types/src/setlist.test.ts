import { describe, expect, it } from 'vitest'
import { isHeadingEntry, isSongEntry, isTransitionEntry, SetlistEntrySchema } from './setlist.js'

describe('SetlistEntrySchema', () => {
  it('parses a legacy song entry without a kind', () => {
    const entry = SetlistEntrySchema.parse({ id: 'e1', songId: 's1', variantId: null, trackId: null })
    expect(isTransitionEntry(entry)).toBe(false)
  })

  it('parses a transition item', () => {
    const entry = SetlistEntrySchema.parse({ id: 't1', kind: 'transition', title: 'Ansage', notes: 'Hallo', estimatedDurationMs: 120000 })
    expect(isTransitionEntry(entry)).toBe(true)
  })

  it('rejects a transition item without a title', () => {
    expect(SetlistEntrySchema.safeParse({ id: 't1', kind: 'transition', title: '', notes: '' }).success).toBe(false)
  })
})

describe('heading style', () => {
  it('parses a section heading as a transition item with style heading', () => {
    const entry = SetlistEntrySchema.parse({ id: 'h1', kind: 'transition', title: 'Set 1', notes: '', style: 'heading' })
    expect(isHeadingEntry(entry)).toBe(true)
    expect(isTransitionEntry(entry)).toBe(true)
    expect(isSongEntry(entry)).toBe(false)
  })

  it('a plain transition item is not a heading', () => {
    const entry = SetlistEntrySchema.parse({ id: 't1', kind: 'transition', title: 'Ansage', notes: '' })
    expect(isHeadingEntry(entry)).toBe(false)
  })

  it('parses a transition with its own transition type', () => {
    const entry = SetlistEntrySchema.parse({
      id: 't1',
      kind: 'transition',
      title: 'Ansage',
      notes: '',
      estimatedDurationMs: 30000,
      transitionType: 'seamless',
    })
    expect(isTransitionEntry(entry) && entry.transitionType).toBe('seamless')
  })
})
