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
    // + Ready-Check, its own widget since 2026-10-17 (was a button in Next Song).
    expect(tier('ready-check')).toBe('gig')
    expect(ALL_WIDGETS.filter((widget) => widget.stageTier === 'gig')).toHaveLength(19)
  })
})

describe('widget parts ("Anzeigen", Marco 2026-10-17)', () => {
  it('each widget type names its parts once, with a label', () => {
    for (const widget of ALL_WIDGETS) {
      const ids = (widget.parts ?? []).map((part) => part.id)
      expect(new Set(ids).size, widget.type).toBe(ids.length)
      for (const part of widget.parts ?? []) expect(part.label.length, `${widget.type}.${part.id}`).toBeGreaterThan(0)
    }
  })

  it('every widget part id is asked for by its widget (useShowPart)', async () => {
    const sources = import.meta.glob('./*Widget.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const all = Object.values(sources).join('\n')
    for (const widget of ALL_WIDGETS) {
      for (const part of widget.parts ?? []) expect(all, `${widget.type}.${part.id}`).toContain(`useShowPart('${part.id}')`)
    }
  })
})
