import { describe, expect, it } from 'vitest'
import { BREAKPOINTS, type Dashboard } from 'shared-types'
import {
  availableWidgets,
  breakpointFor,
  GRID_COLUMNS,
  GRID_ROWS,
  gridHeight,
  gridMetrics,
  hasOverlap,
  normalizeLayout,
  resolveInteraction,
  withWidgetAppended,
  withWidgetRemoved,
} from './dashboardLayout'
import { defaultDashboards } from './defaultDashboards'
import type { CapabilityStatus } from './capabilities'

const overlaps = hasOverlap

function emptyDashboard(): Dashboard {
  return { id: 'd1', name: 'Test', order: 0, widgets: [], layouts: {} }
}

describe('defaultDashboards', () => {
  const dashboards = defaultDashboards()

  it('seeds a Prompter and a Monitoring dashboard', () => {
    expect(dashboards.map((dashboard) => dashboard.name)).toEqual(['Prompter', 'Monitoring'])
    expect(dashboards.map((dashboard) => dashboard.order)).toEqual([0, 1])
  })

  it('puts a switcher on every dashboard, so no device can get stranded', () => {
    for (const dashboard of dashboards) {
      expect(dashboard.widgets.some((widget) => widget.type === 'dashboard-switcher')).toBe(true)
    }
  })

  it('carries a layout for every breakpoint, with one entry per widget', () => {
    for (const dashboard of dashboards) {
      for (const breakpoint of BREAKPOINTS) {
        const layout = dashboard.layouts[breakpoint]
        expect(layout).toHaveLength(dashboard.widgets.length)
        expect(layout?.map((item) => item.i).sort()).toEqual(
          dashboard.widgets.map((widget) => widget.i).sort(),
        )
      }
    }
  })

  it('gives the two dashboards distinct ids', () => {
    expect(dashboards[0].id).not.toBe(dashboards[1].id)
  })
})

describe('withWidgetAppended', () => {
  it('places the widget below everything else at every breakpoint', () => {
    const dashboard = withWidgetAppended(emptyDashboard(), 'clock', { w: 3, h: 2 }, 'clock-1')
    const withSecond = withWidgetAppended(dashboard, 'prompter', { w: 12, h: 8 }, 'prompter-1')

    for (const breakpoint of BREAKPOINTS) {
      const items = withSecond.layouts[breakpoint]
      expect(items?.map((item) => item.y)).toEqual([0, 2])
    }
    expect(withSecond.widgets.map((widget) => widget.type)).toEqual(['clock', 'prompter'])
  })

  it('keeps min sizes from the widget definition', () => {
    const dashboard = withWidgetAppended(
      emptyDashboard(),
      'prompter',
      { w: 12, h: 8, minW: 3, minH: 6 },
      'prompter-1',
    )
    expect(dashboard.layouts.lg?.[0]).toMatchObject({ minW: 3, minH: 6 })
  })
})

describe('withWidgetRemoved', () => {
  it('drops the instance from the widget list and every layout', () => {
    const dashboard = withWidgetAppended(
      withWidgetAppended(emptyDashboard(), 'clock', { w: 3, h: 2 }, 'clock-1'),
      'prompter',
      { w: 12, h: 8 },
      'prompter-1',
    )
    const pruned = withWidgetRemoved(dashboard, 'clock-1')

    expect(pruned.widgets.map((widget) => widget.i)).toEqual(['prompter-1'])
    for (const breakpoint of BREAKPOINTS) {
      expect(pruned.layouts[breakpoint]?.map((item) => item.i)).toEqual(['prompter-1'])
    }
  })

  it('leaves the dashboard untouched for an unknown instance', () => {
    const dashboard = withWidgetAppended(emptyDashboard(), 'clock', { w: 3, h: 2 }, 'clock-1')
    expect(withWidgetRemoved(dashboard, 'nope').widgets).toHaveLength(1)
  })
})

describe('availableWidgets', () => {
  const definitions = [
    { type: 'prompter', requires: [] },
    { type: 'midi-status', requires: ['midi-input'] },
    { type: 'iem', requires: ['mixer'] },
  ]
  const capabilities = new Map<string, CapabilityStatus>([
    ['midi-input', 'degraded'],
    ['mixer', 'missing'],
  ])

  it('hides widgets whose plugin the band does not have', () => {
    expect(availableWidgets(definitions, capabilities).map((d) => d.type)).toEqual([
      'prompter',
      'midi-status',
    ])
  })

  it('still offers a widget whose hardware is merely unreachable', () => {
    // Degraded widgets are allowed on a dashboard - they just grey out.
    expect(availableWidgets(definitions, capabilities).some((d) => d.type === 'midi-status')).toBe(
      true,
    )
  })

  it('offers core widgets even with no plugins at all', () => {
    expect(availableWidgets(definitions, new Map()).map((d) => d.type)).toEqual(['prompter'])
  })
})

describe('gridMetrics', () => {
  it('never renders a grid taller than the container', () => {
    // The invariant the whole "widgets stay on screen" promise rests on. 300px used to
    // produce a 392px grid, and overflow:hidden then swallowed the bottom rows.
    for (let height = 24; height <= 2000; height += 7) {
      expect(gridHeight(gridMetrics(height))).toBeLessThanOrEqual(height)
    }
  })

  it('uses nearly all of the container', () => {
    for (const height of [300, 500, 800, 1280]) {
      expect(gridHeight(gridMetrics(height))).toBeGreaterThan(height - GRID_ROWS - 16)
    }
  })

  it('keeps rows at least one pixel tall', () => {
    expect(gridMetrics(24).rowHeight).toBeGreaterThanOrEqual(1)
    expect(gridMetrics(1).rowHeight).toBeGreaterThanOrEqual(1)
  })

  it('shrinks the gaps on a short container instead of the rows alone', () => {
    expect(gridMetrics(300).margin).toBeLessThan(gridMetrics(800).margin)
  })

  it('falls back before the container has been measured', () => {
    expect(gridMetrics(0).rowHeight).toBe(28)
  })
})

describe('breakpointFor', () => {
  it('maps the docs/07 device classes', () => {
    expect(breakpointFor(390)).toBe('sm')
    expect(breakpointFor(800)).toBe('md')
    expect(breakpointFor(1280)).toBe('lg')
    expect(breakpointFor(1920)).toBe('xl')
  })

  it('puts a tablet in portrait and in landscape on different breakpoints', () => {
    // The bug this replaced: the breakpoint came from a callback that only fires on a
    // change, so a portrait tablet wrote its edits into the landscape layout.
    expect(breakpointFor(834)).not.toBe(breakpointFor(1194))
  })

  it('handles a zero width before measurement', () => {
    expect(breakpointFor(0)).toBe('sm')
  })
})

describe('normalizeLayout', () => {
  it('resolves the collision that clamping alone would create', () => {
    // The real crash: a widget dragged past the bottom edge, clamped onto one already
    // sitting in the last row. Overlap plus maxRows sent react-grid-layout into an
    // endless correction loop and blanked the screen.
    const layout = [
      { i: 'midi', x: 7, y: 21, w: 3, h: 3 },
      { i: 'clock', x: 8, y: 24, w: 2, h: 3 },
    ]
    const result = normalizeLayout(layout)
    for (const item of result) {
      expect(item.y + item.h).toBeLessThanOrEqual(GRID_ROWS)
    }
    expect(overlaps(result)).toBe(false)
  })

  it('never overlaps while the widgets still fit', () => {
    // Six 6x4 widgets need 144 of the 288 cells - crowded but satisfiable.
    const layout = Array.from({ length: 6 }, (_, i) => ({
      i: `w${i}`,
      x: 5,
      y: GRID_ROWS + i,
      w: 6,
      h: 4,
    }))
    const result = normalizeLayout(layout)
    expect(overlaps(result)).toBe(false)
    expect(result).toHaveLength(6)
    for (const item of result) {
      expect(item.y + item.h).toBeLessThanOrEqual(GRID_ROWS)
      expect(item.x + item.w).toBeLessThanOrEqual(GRID_COLUMNS)
    }
  })

  it('shrinks a latecomer instead of stacking it on someone else', () => {
    const layout = [
      { i: 'big', x: 0, y: 0, w: 12, h: 22 },
      { i: 'late', x: 0, y: 0, w: 12, h: 8 },
    ]
    const late = normalizeLayout(layout).find((item) => item.i === 'late')
    expect(late).toMatchObject({ y: 22, h: 2 })
    expect(overlaps(normalizeLayout(layout))).toBe(false)
  })

  it('keeps every widget, even when the grid is overfull', () => {
    const layout = Array.from({ length: 60 }, (_, i) => ({
      i: `w${i}`,
      x: 0,
      y: 0,
      w: 12,
      h: 6,
    }))
    // Losing a widget silently would be worse than a crowded grid.
    expect(normalizeLayout(layout)).toHaveLength(60)
  })

  it('leaves an already valid layout exactly as it is', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 12, h: 3 },
      { i: 'b', x: 0, y: 3, w: 7, h: 3 },
      { i: 'c', x: 7, y: 3, w: 5, h: 3 },
      { i: 'd', x: 0, y: 6, w: 12, h: 18 },
    ]
    expect(normalizeLayout(layout)).toEqual(layout)
  })

  it('pulls an item that sits past the bottom back to the nearest valid row', () => {
    const [item] = normalizeLayout([{ i: 'a', x: 0, y: GRID_ROWS + 10, w: 4, h: 4 }])
    // Clamped to the last row it fits in, NOT compacted to the top: this item is alone on
    // the grid, so there is nothing to collide with, and clamping is the minimal repair.
    expect(item.y).toBe(GRID_ROWS - 4)
    expect(item.y + item.h).toBeLessThanOrEqual(GRID_ROWS)
  })

  it('pulls an item that sits past the right edge back inside', () => {
    const [item] = normalizeLayout([{ i: 'a', x: GRID_COLUMNS + 5, y: 0, w: 3, h: 2 }])
    expect(item.x).toBe(GRID_COLUMNS - 3)
  })

  it('shrinks an item that is larger than the grid itself', () => {
    const [item] = normalizeLayout([{ i: 'a', x: 0, y: 0, w: 99, h: 99 }])
    expect(item.w).toBe(GRID_COLUMNS)
    expect(item.h).toBe(GRID_ROWS)
    expect(item.x).toBe(0)
    expect(item.y).toBe(0)
  })

  it('lowers a minimum that no longer fits, so it cannot push the item back out', () => {
    const [item] = normalizeLayout([{ i: 'a', x: 0, y: 0, w: 2, h: 99, minH: 40, minW: 8 }])
    expect(item.minH).toBe(GRID_ROWS)
    expect(item.minW).toBe(2)
  })

  it('leaves a compact, valid layout untouched', () => {
    const layout = [
      { i: 'a', x: 0, y: 0, w: 12, h: 3 },
      { i: 'b', x: 2, y: 3, w: 4, h: 5, minH: 2 },
    ]
    expect(normalizeLayout(layout)).toEqual(layout)
  })

  it('preserves a deliberate vertical gap between two widgets', () => {
    // The actual bug: a musician drags a widget down to leave breathing room above the
    // next one. Nothing here overlaps or leaves the grid, so there is nothing to repair -
    // and "nothing to repair" must mean "return it exactly as given", not "re-pack it
    // densely and delete the gap", which is what this function used to do on every single
    // render (Dashboard.tsx calls it on every read).
    const layout = [
      { i: 'a', x: 0, y: 0, w: 12, h: 2 },
      { i: 'b', x: 0, y: 8, w: 12, h: 2 },
    ]
    expect(normalizeLayout(layout)).toEqual(layout)
  })

  it('preserves a gap even when a differently-ordered item is also valid', () => {
    // Reading order in the array must not matter - only whether the layout is valid.
    const layout = [
      { i: 'b', x: 0, y: 10, w: 6, h: 3 },
      { i: 'a', x: 0, y: 0, w: 6, h: 3 },
    ]
    expect(normalizeLayout(layout)).toEqual(layout)
  })

  it('repairs negative coordinates', () => {
    const [item] = normalizeLayout([{ i: 'a', x: -5, y: -3, w: 2, h: 2 }])
    expect(item).toMatchObject({ x: 0, y: 0 })
  })

  it('keeps every default dashboard inside the grid', () => {
    for (const dashboard of defaultDashboards()) {
      for (const breakpoint of BREAKPOINTS) {
        for (const item of dashboard.layouts[breakpoint] ?? []) {
          expect(item.x + item.w).toBeLessThanOrEqual(GRID_COLUMNS)
          expect(item.y + item.h).toBeLessThanOrEqual(GRID_ROWS)
        }
      }
    }
  })
})

describe('resolveInteraction', () => {
  it('restores a widget the active one only passed over, not actually blocking it anymore', () => {
    // The reported bug: dragging "a" down across "b" pushes "b" aside; once "a" clears "b"'s
    // original cell entirely, "b" has no reason left to stay displaced.
    const baseline = [
      { i: 'a', x: 0, y: 0, w: 4, h: 3 },
      { i: 'b', x: 0, y: 3, w: 4, h: 3 },
    ]
    // react-grid-layout's own collision-avoidance, mid-drag: "a" landed where "b" used to
    // be, and "b" got shoved down out of the way - but "a" isn't over "b" anymore.
    const current = [
      { i: 'a', x: 0, y: 6, w: 4, h: 3 },
      { i: 'b', x: 0, y: 9, w: 4, h: 3 },
    ]
    const result = resolveInteraction(baseline, 'a', current)
    expect(result).toEqual([
      { i: 'a', x: 0, y: 6, w: 4, h: 3 },
      { i: 'b', x: 0, y: 3, w: 4, h: 3 },
    ])
  })

  it('leaves a widget displaced only while it is still genuinely in the way', () => {
    const baseline = [
      { i: 'a', x: 0, y: 0, w: 4, h: 3 },
      { i: 'b', x: 0, y: 3, w: 4, h: 3 },
    ]
    // "a" was dropped exactly on top of "b"'s old spot - restoring "b" there would overlap.
    const current = [
      { i: 'a', x: 0, y: 3, w: 4, h: 3 },
      { i: 'b', x: 0, y: 6, w: 4, h: 3 },
    ]
    const result = resolveInteraction(baseline, 'a', current)
    expect(overlaps(result)).toBe(false)
    const a = result.find((item) => item.i === 'a')
    const b = result.find((item) => item.i === 'b')
    expect(a).toEqual({ i: 'a', x: 0, y: 3, w: 4, h: 3 })
    expect(b?.y).not.toBe(3)
  })

  it('does not touch a widget uninvolved in the interaction, even if others moved', () => {
    const baseline = [
      { i: 'a', x: 0, y: 0, w: 4, h: 3 },
      { i: 'b', x: 0, y: 3, w: 4, h: 3 },
      { i: 'c', x: 8, y: 8, w: 4, h: 3 },
    ]
    const current = [
      { i: 'a', x: 0, y: 6, w: 4, h: 3 },
      { i: 'b', x: 0, y: 9, w: 4, h: 3 },
      { i: 'c', x: 8, y: 8, w: 4, h: 3 },
    ]
    const result = resolveInteraction(baseline, 'a', current)
    expect(result.find((item) => item.i === 'c')).toEqual(baseline[2])
  })

  it('leaves a deliberate gap alone when the interaction never touched it', () => {
    const baseline = [
      { i: 'a', x: 0, y: 0, w: 12, h: 2 },
      { i: 'b', x: 0, y: 8, w: 12, h: 2 },
    ]
    const current = [
      { i: 'a', x: 4, y: 0, w: 12, h: 2 },
      { i: 'b', x: 0, y: 8, w: 12, h: 2 },
    ]
    expect(resolveInteraction(baseline, 'a', current)).toEqual(current)
  })

  it('falls back to the current layout unchanged if the active widget went missing', () => {
    const baseline = [{ i: 'a', x: 0, y: 0, w: 4, h: 3 }]
    const current = [{ i: 'b', x: 0, y: 0, w: 4, h: 3 }]
    expect(resolveInteraction(baseline, 'a', current)).toEqual(current)
  })
})

describe('withWidgetAppended (bounds)', () => {
  it('does not close a gap left between existing widgets when a new one is added', () => {
    const dashboard: Dashboard = {
      ...emptyDashboard(),
      widgets: [
        { i: 'a', type: 'clock' },
        { i: 'b', type: 'clock' },
      ],
      layouts: {
        lg: [
          { i: 'a', x: 0, y: 0, w: 12, h: 2 },
          { i: 'b', x: 0, y: 8, w: 12, h: 2 },
        ],
      },
    }
    const updated = withWidgetAppended(dashboard, 'midi-status', { w: 3, h: 2 }, 'c')
    expect(updated.layouts.lg).toEqual([
      { i: 'a', x: 0, y: 0, w: 12, h: 2 },
      { i: 'b', x: 0, y: 8, w: 12, h: 2 },
      { i: 'c', x: 0, y: 10, w: 3, h: 2 },
    ])
  })

  it('never places a widget past the last row', () => {
    let dashboard = emptyDashboard()
    // Far more widgets than fit: the grid must absorb them, not grow past the screen.
    for (let i = 0; i < 30; i++) {
      dashboard = withWidgetAppended(dashboard, 'clock', { w: 3, h: 4 }, `clock-${i}`)
    }
    for (const breakpoint of BREAKPOINTS) {
      for (const item of dashboard.layouts[breakpoint] ?? []) {
        expect(item.y + item.h).toBeLessThanOrEqual(GRID_ROWS)
      }
    }
  })

  it('shrinks the newcomer to the remaining height instead of overflowing', () => {
    let dashboard = withWidgetAppended(emptyDashboard(), 'prompter', { w: 12, h: 22 }, 'p1')
    dashboard = withWidgetAppended(dashboard, 'clock', { w: 12, h: 6 }, 'c1')
    const clock = dashboard.layouts.lg?.find((item) => item.i === 'c1')
    expect(clock).toMatchObject({ y: 22, h: 2 })
  })
})
