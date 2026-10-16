import { createContext, useContext } from 'react'

/** The widget types on the dashboard a widget sits on - lets a widget leave a control to another
 * widget on the same screen (e.g. "Übernahme erzwingen" only in the transport, 2026-10-16).
 * Empty outside a dashboard, so a widget shown on its own keeps everything. */
export const DashboardWidgetTypes = createContext<ReadonlySet<string>>(new Set())

export function useDashboardHasWidget(type: string): boolean {
  return useContext(DashboardWidgetTypes).has(type)
}
