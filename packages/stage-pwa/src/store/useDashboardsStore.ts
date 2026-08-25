import { create } from 'zustand'
import { randomId } from '../lib/id'
import type { Dashboard, LayoutItem, Breakpoint } from 'shared-types'
import {
  getAllDashboards,
  getDashboardsDb,
  putDashboard,
  removeDashboard,
  switchDashboardsWorkspace,
  type DashboardDoc,
} from '../lib/dashboardsDb'
import { defaultDashboards } from '../lib/defaultDashboards'

function toDashboard(doc: DashboardDoc): Dashboard {
  return {
    id: doc.id,
    name: doc.name,
    order: doc.order,
    widgets: doc.widgets,
    layouts: doc.layouts,
  }
}

function byOrder(a: Dashboard, b: Dashboard): number {
  return a.order - b.order
}

interface DashboardsState {
  dashboards: Dashboard[]
  loaded: boolean
  /**
   * Bumped by resetToDefaults - a signal for Dashboard.tsx to force a fresh
   * react-grid-layout instance rather than let it reconcile in place. Reset removes and
   * recreates every dashboard document with the same ids, so a dashboard.id-based React
   * key alone doesn't change; without a fresh mount, react-grid-layout's own internal
   * effect can end up resyncing against its own stale internal state instead of the fresh
   * props mid-churn, regenerating a slightly different (and equally wrong) layout on every
   * render forever - a real infinite loop purely inside the library, not our own code.
   */
  resetNonce: number
  init: (workspaceId: string) => Promise<void>
  save: (dashboard: Dashboard) => Promise<void>
  create: (name: string) => Promise<Dashboard>
  duplicate: (id: string, newName: string) => Promise<Dashboard | null>
  rename: (id: string, name: string) => Promise<void>
  /** Refuses to delete the last dashboard - a device with none has nothing to show. */
  remove: (id: string) => Promise<void>
  /** Throws away every dashboard and re-seeds the defaults. */
  resetToDefaults: () => Promise<void>
  setLayout: (id: string, breakpoint: Breakpoint, layout: LayoutItem[]) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<Dashboard> | null = null

async function refresh(set: (partial: Partial<DashboardsState>) => void) {
  const docs = await getAllDashboards()
  set({ dashboards: docs.map(toDashboard).sort(byOrder) })
}

export const useDashboardsStore = create<DashboardsState>((set, get) => ({
  dashboards: [],
  loaded: false,
  resetNonce: 0,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchDashboardsWorkspace(workspaceId)
    set({ dashboards: [], loaded: false })

    await refresh(set)
    // A workspace that has never been opened gets the starter dashboards. Any other
    // tablet in the mesh will simply replicate them.
    if (get().dashboards.length === 0) {
      for (const dashboard of defaultDashboards()) await putDashboard(dashboard)
      await refresh(set)
    }
    set({ loaded: true })

    changesHandle = getDashboardsDb().changes({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  save: async (dashboard) => {
    await putDashboard(dashboard)
  },
  create: async (name) => {
    const order = get().dashboards.reduce((max, item) => Math.max(max, item.order), -1) + 1
    const dashboard: Dashboard = { id: randomId(), name, order, widgets: [], layouts: {} }
    await putDashboard(dashboard)
    return dashboard
  },
  duplicate: async (id, newName) => {
    const source = get().dashboards.find((dashboard) => dashboard.id === id)
    if (!source) return null
    const order = get().dashboards.reduce((max, item) => Math.max(max, item.order), -1) + 1
    const copy: Dashboard = {
      ...structuredClone(source),
      id: randomId(),
      name: newName,
      order,
    }
    await putDashboard(copy)
    return copy
  },
  rename: async (id, name) => {
    const existing = get().dashboards.find((dashboard) => dashboard.id === id)
    if (!existing) return
    await putDashboard({ ...existing, name })
  },
  remove: async (id) => {
    if (get().dashboards.length <= 1) return
    await removeDashboard(id)
  },
  resetToDefaults: async () => {
    for (const dashboard of get().dashboards) await removeDashboard(dashboard.id)
    for (const dashboard of defaultDashboards()) await putDashboard(dashboard)
    await refresh(set)
    set({ resetNonce: get().resetNonce + 1 })
  },
  setLayout: async (id, breakpoint, layout) => {
    const existing = get().dashboards.find((dashboard) => dashboard.id === id)
    if (!existing) return
    await putDashboard({ ...existing, layouts: { ...existing.layouts, [breakpoint]: layout } })
  },
}))
