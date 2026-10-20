import { describe, expect, it, vi } from 'vitest'

// The dialogs' stores pull in a real PouchDB at import time.
vi.mock('pouchdb-browser', () => ({ default: class {} }))

const { formatCommentDirective, listCommentDirectives, listTabBlocks } = await import('../lib/chordpro')
const { tabBlockLines } = await import('./InsertNoteDialogs')

describe('what "+ Kommentar" / "+ Tab" write reads back as the same thing (#608)', () => {
  it('a comment for Marco and Jamie', () => {
    const [comment] = listCommentDirectives(formatCommentDirective('Solo 8 Takte', ['Marco', 'Jamie']))
    expect(comment).toMatchObject({ text: 'Solo 8 Takte', targets: ['marco', 'jamie'] })
  })

  it('a tab for Marco: one block with the six strings inside, only for him', () => {
    const [block] = listTabBlocks(`[C]Line\n${tabBlockLines(['Marco'])}\n[G]After`)
    expect(block).toMatchObject({ targets: ['marco'], lineNumber: 1, lineCount: 6 })
  })

  it('a tab for everyone has no targets', () => {
    expect(tabBlockLines(null).split('\n')[0]).toBe('{start_of_tab}')
    expect(listTabBlocks(tabBlockLines(null))[0]?.targets).toBeNull()
  })
})
