import { describe, expect, it } from 'vitest'
import { isTransitionEntry, SetlistEntrySchema } from './setlist.js'

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
