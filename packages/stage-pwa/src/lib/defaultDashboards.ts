import { BREAKPOINTS, type Dashboard, type LayoutItem, type WidgetInstance } from 'shared-types'

/**
 * The grid is 12 columns wide at every breakpoint; only the row heights differ, so a
 * layout laid out for the stage monitor still reads on a phone. Kept free of the widget
 * registry on purpose - geometry is a layout decision, and it avoids an import cycle
 * (registry -> dashboard-switcher widget -> dashboards store -> this file).
 */
export const GRID_COLUMNS = 12

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

function build(name: string, order: number, placed: Placed[]): Dashboard {
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

  const layouts = Object.fromEntries(BREAKPOINTS.map((breakpoint) => [breakpoint, items]))

  return { id: crypto.randomUUID(), name, order, widgets, layouts }
}

/**
 * What a fresh workspace starts with: the dashboard that matches the app as it was before
 * dashboards existed, plus a second one, so the switching concept is visible from the
 * first launch. A "Light" dashboard only makes sense once a lighting plugin is installed.
 */
export function defaultDashboards(): Dashboard[] {
  return [
    build('Prompter', 0, [
      { type: 'dashboard-switcher', x: 0, y: 0, w: 12, h: 2, minH: 2 },
      { type: 'next-song', x: 0, y: 2, w: 7, h: 2, minH: 2 },
      { type: 'clock', x: 7, y: 2, w: 2, h: 2, minH: 2 },
      { type: 'midi-status', x: 9, y: 2, w: 3, h: 2, minH: 2 },
      { type: 'prompter', x: 0, y: 4, w: 12, h: 16, minH: 6 },
    ]),
    build('Monitoring', 1, [
      { type: 'dashboard-switcher', x: 0, y: 0, w: 12, h: 2, minH: 2 },
      { type: 'clock', x: 0, y: 2, w: 4, h: 3, minH: 2 },
      { type: 'midi-status', x: 4, y: 2, w: 8, h: 3, minH: 2 },
      { type: 'iem-more-me', x: 0, y: 5, w: 6, h: 8, minH: 5 },
      { type: 'quick-actions', x: 6, y: 5, w: 6, h: 8, minH: 4 },
    ]),
  ]
}
