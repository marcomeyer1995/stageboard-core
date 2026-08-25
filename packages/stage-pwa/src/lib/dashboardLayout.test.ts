import { describe, expect, it } from 'vitest'
import { BREAKPOINTS, type Dashboard } from 'shared-types'
import { availableWidgets, withWidgetAppended, withWidgetRemoved } from './dashboardLayout'
import { defaultDashboards } from './defaultDashboards'
import type { CapabilityStatus } from './capabilities'

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
