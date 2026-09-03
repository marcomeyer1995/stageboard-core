import { BREAKPOINTS, type Dashboard, type LayoutItem, type WidgetInstance } from 'shared-types'
import { normalizeLayout } from './dashboardLayout'

/**
 * Stable ids on purpose. Every device seeds when it finds an empty workspace, so two
 * tablets starting at the same time both seed - with random ids that produces duplicate
 * "Prompter" and "Monitoring" dashboards once replication catches up. With fixed ids the
 * two writes are the same document, and CouchDB resolves them as an ordinary conflict.
 */
const DEFAULT_IDS = {
  prompter: 'default-prompter',
  monitoring: 'default-monitoring',
} as const

interface Placed {
  type: string
  config?: Record<string, unknown>
  /** Same slot at every breakpoint; the grid reflows what does not fit. */
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

function build(id: string, name: string, order: number, placed: Placed[]): Dashboard {
  const widgets: WidgetInstance[] = placed.map((item, index) => ({
    i: `${item.type}-${index}`,
    type: item.type,
    ...(item.config ? { config: item.config } : {}),
  }))

  const items: LayoutItem[] = placed.map((item, index) => ({
    i: `${item.type}-${index}`,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    ...(item.minW ? { minW: item.minW } : {}),
    ...(item.minH ? { minH: item.minH } : {}),
  }))

  const layouts = Object.fromEntries(
    BREAKPOINTS.map((breakpoint) => [breakpoint, normalizeLayout(items)]),
  )

  return { id, name, order, widgets, layouts, visibility: 'public' }
}

/**
 * What a fresh workspace starts with: the dashboard that matches the app as it was before
 * dashboards existed, plus a second one, so the switching concept is visible from the
 * first launch. Both fill all 24 rows exactly - a stage screen should not waste height.
 * A "Light" dashboard only makes sense once a lighting plugin is installed.
 */
export function defaultDashboards(): Dashboard[] {
  return [
    build(DEFAULT_IDS.prompter, 'Prompter', 0, [
      { type: 'dashboard-switcher', x: 0, y: 0, w: 12, h: 3, minH: 2 },
      { type: 'next-song', x: 0, y: 3, w: 5, h: 3, minH: 2 },
      { type: 'show-transport', x: 5, y: 3, w: 4, h: 3, minH: 2 },
      { type: 'midi-status', x: 9, y: 3, w: 3, h: 3, minH: 2 },
      { type: 'prompter', x: 0, y: 6, w: 12, h: 18, minH: 6 },
    ]),
    build(DEFAULT_IDS.monitoring, 'Monitoring', 1, [
      { type: 'dashboard-switcher', x: 0, y: 0, w: 12, h: 3, minH: 2 },
      { type: 'show-transport', x: 0, y: 3, w: 4, h: 4, minH: 2 },
      { type: 'midi-status', x: 4, y: 3, w: 8, h: 4, minH: 2 },
      { type: 'iem-more-me', x: 0, y: 7, w: 6, h: 17, minH: 5 },
      { type: 'quick-actions', x: 6, y: 7, w: 6, h: 17, minH: 4 },
    ]),
  ]
}
