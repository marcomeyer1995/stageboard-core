import { describe, expect, it, vi } from 'vitest'

// registry.tsx pulls in widgets that open a PouchDB at module load (same mock as WidgetLibrary.test.tsx).
vi.mock('pouchdb-browser', () => ({
  default: class FakePouchDB {
    sync() {
      return { on: () => this, cancel: () => {} }
    }
  },
}))

const { ALL_WIDGETS } = await import('./registry')

describe('widget stage tiers', () => {
  it('gives every widget a tier', () => {
    for (const widget of ALL_WIDGETS) expect(['gig', 'glance', 'rehearsal', 'layout']).toContain(widget.stageTier)
  })

  it('follows the tiers agreed with Marco (2026-09-27)', () => {
    const tier = (type: string) => ALL_WIDGETS.find((widget) => widget.type === type)?.stageTier
    expect(tier('tuner')).toBe('gig')
    expect(tier('track-override')).toBe('gig')
    expect(tier('sync-check')).toBe('glance')
    expect(tier('loop-trainer')).toBe('rehearsal')
    expect(tier('circle-of-fifths')).toBe('rehearsal')
    expect(tier('chord-reference')).toBe('rehearsal')
    expect(tier('separator')).toBe('layout')
    expect(ALL_WIDGETS.filter((widget) => widget.stageTier === 'gig')).toHaveLength(17)
  })
})
