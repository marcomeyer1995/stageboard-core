import { describe, expect, it } from 'vitest'
import { searchRank } from './widgetSearch'

const widget = (title: string, description = '') => ({ title, description })

describe('searchRank', () => {
  it('ranks title start, then a later title word, then inside the title, then the description', () => {
    expect(searchRank(widget('Uhr'), 'uhr')).toBe(0)
    expect(searchRank(widget('Festival-Uhr'), 'uhr')).toBe(1)
    expect(searchRank(widget('Stimmgerät'), 'gerät')).toBe(2)
    expect(searchRank(widget('Tempo-Korrektur', 'Klick schneller'), 'klick')).toBe(3)
    expect(searchRank(widget('Prompter', 'Liedtext'), 'uhr')).toBeNull()
  })
})
