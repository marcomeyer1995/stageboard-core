import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Dashboard } from 'shared-types'

interface MenuPrefs {
  /** Dashboard ids in this device's own order (dragged in the menu); others follow in band order. */
  order: string[]
  /** Dashboards this device doesn't list - e.g. the template after making an own copy of it. */
  hidden: string[]
}

interface DashboardMenuState {
  byWorkspace: Record<string, MenuPrefs>
  setOrder: (workspaceId: string, order: string[]) => void
  setHidden: (workspaceId: string, dashboardId: string, hidden: boolean) => void
}

/**
 * How this device lists the dashboards (Marco, dashboard editing redesign): order and hidden
 * entries are per device - each musician arranges their own menu, nobody else's changes, and a
 * template's order (admin-only in the band data, #16) is never touched.
 */
export const useDashboardMenuStore = create<DashboardMenuState>()(
  persist(
    (set) => ({
      byWorkspace: {},
      setOrder: (workspaceId, order) =>
        set((state) => {
          const prefs = state.byWorkspace[workspaceId] ?? { order: [], hidden: [] }
          return { byWorkspace: { ...state.byWorkspace, [workspaceId]: { ...prefs, order: mergeOrder(prefs.order, order) } } }
        }),
      setHidden: (workspaceId, dashboardId, hidden) =>
        set((state) => {
          const prefs = state.byWorkspace[workspaceId] ?? { order: [], hidden: [] }
          const next = prefs.hidden.filter((id) => id !== dashboardId)
          if (hidden) next.push(dashboardId)
          return { byWorkspace: { ...state.byWorkspace, [workspaceId]: { ...prefs, hidden: next } } }
        }),
    }),
    { name: 'stageboard-dashboard-menu' },
  ),
)

/**
 * `arranged` is the new order of the dashboards one mode lists. Only their places in the stored
 * order change - the other mode's dashboards keep theirs (replacing the whole list threw away the
 * order arranged in the other mode, #422 review).
 */
export function mergeOrder(stored: readonly string[], arranged: readonly string[]): string[] {
  const merged = [...stored, ...arranged.filter((id) => !stored.includes(id))]
  const moving = new Set(arranged)
  let next = 0
  return merged.map((id) => (moving.has(id) ? arranged[next++]! : id))
}

/** The dashboards in this device's order: the dragged ones first, as dragged, then the rest in
 * band order (new dashboards appear at the end until moved). */
export function inMenuOrder(dashboards: readonly Dashboard[], order: readonly string[]): Dashboard[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  return [...dashboards].sort((a, b) => (rank.get(a.id) ?? order.length + a.order) - (rank.get(b.id) ?? order.length + b.order))
}
