import { BREAKPOINTS, type Dashboard, type LayoutItem } from 'shared-types'
import type { CapabilityId } from 'shared-types'
import { capabilityStatusFor, type CapabilityStatus } from './capabilities'
import type { WidgetSize } from '../widgets/registry'

/**
 * Places a new widget at the bottom of every breakpoint's layout. Appending rather than
 * inserting means nothing the musician already positioned moves out from under them.
 */
export function withWidgetAppended(
  dashboard: Dashboard,
  type: string,
  size: WidgetSize,
  instanceId: string,
): Dashboard {
  const layouts = Object.fromEntries(
    BREAKPOINTS.map((breakpoint) => {
      const items = dashboard.layouts[breakpoint] ?? []
      const bottom = items.reduce((max, item) => Math.max(max, item.y + item.h), 0)
      const placed: LayoutItem = { ...size, i: instanceId, x: 0, y: bottom }
      return [breakpoint, [...items, placed]]
    }),
  )

  return { ...dashboard, widgets: [...dashboard.widgets, { i: instanceId, type }], layouts }
}

/** Removes a widget instance from the widget list and from every breakpoint's layout. */
export function withWidgetRemoved(dashboard: Dashboard, instanceId: string): Dashboard {
  return {
    ...dashboard,
    widgets: dashboard.widgets.filter((widget) => widget.i !== instanceId),
    layouts: Object.fromEntries(
      Object.entries(dashboard.layouts).map(([breakpoint, items]) => [
        breakpoint,
        items.filter((item) => item.i !== instanceId),
      ]),
    ),
  }
}

/**
 * The widget library from docs/07 section 4: a widget whose plugin the band does not have
 * is not offered at all - that is what keeps simple setups uncluttered. Merely unreachable
 * hardware still shows up, because those widgets are allowed to sit in a layout greyed out.
 */
export function availableWidgets<T extends { requires: CapabilityId[] }>(
  definitions: T[],
  capabilities: Map<CapabilityId, CapabilityStatus>,
): T[] {
  return definitions.filter(
    (definition) => capabilityStatusFor(definition.requires, capabilities) !== 'missing',
  )
}
