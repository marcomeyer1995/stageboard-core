import { describe, expect, it } from 'vitest'
import { fitStatusBarItems, normalizeStatusBarOrder, STATUS_BAR_ITEMS } from './statusBarItems'

describe('status bar ranking', () => {
  const widths = { duration: 60, master: 30, clock: 60, stateText: 90, sync: 30, mode: 50, profile: 70, screen: 80, syncText: 90 }

  it('keeps items in rank order until the title would get less than its minimum', () => {
    const shown = fitStatusBarItems(STATUS_BAR_ITEMS, widths, 160 + 60 + 30 + 60 + 10)
    expect([...shown]).toEqual(['duration', 'master', 'clock'])
  })

  it('stops at the first item that does not fit, so a smaller one behind it does not jump in', () => {
    const shown = fitStatusBarItems(['stateText', 'sync'], { stateText: 90, sync: 30 }, 160 + 50)
    expect([...shown]).toEqual([])
  })

  it('an item that is not there right now costs nothing', () => {
    const shown = fitStatusBarItems(['master', 'clock'], { clock: 60 }, 160 + 60)
    expect([...shown]).toEqual(['master', 'clock'])
  })

  it('brings a stored ranking up to date: unknown ids out, new items appended', () => {
    expect(normalizeStatusBarOrder(['clock', 'gone', 'duration'])).toEqual(['clock', 'duration', ...STATUS_BAR_ITEMS.filter((i) => i !== 'clock' && i !== 'duration')])
  })
})
