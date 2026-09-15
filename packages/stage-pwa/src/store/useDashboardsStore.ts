import { create } from 'zustand'
import { randomId } from '../lib/id'
import type { Dashboard, LayoutItem, Breakpoint, WidgetInstance } from 'shared-types'
import {
  dashboardsChanges,
  getAllDashboards,
  putDashboard,
  removeDashboard,
  switchDashboardsWorkspace,
  updateDashboard,
  type DashboardDoc,
} from '../lib/dashboardsDb'
import { defaultDashboards } from '../lib/defaultDashboards'
import { configLog } from '../lib/configDebug'

function toDashboard(doc: DashboardDoc): Dashboard {
  return {
    id: doc.id,
    name: doc.name,
    order: doc.order,
    widgets: doc.widgets,
    layouts: doc.layouts,
    ownerProfileId: doc.ownerProfileId,
    ownerRole: doc.ownerRole,
    visibility: doc.visibility ?? 'public',
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
  /**
   * A true read-modify-write against the *freshly re-read* document (`updateDashboard`,
   * `workspaceCollection.ts`'s `update`), not a spread of this store's own (possibly stale)
   * cached `dashboards` state the way `save({...active, ...})` used to do it. Several
   * independently-debounced fields on the same widget instance (a Prompter config panel with
   * multiple sliders, `useDeferredSliderValue.ts`; the "⋯" menu's frameless toggle) can commit
   * moments apart; reading from the store risked one commit's write silently overwriting
   * another's with stale data even when neither write actually conflicted (found live, Marco
   * 2026-09-14: a slider value visibly oscillating for several seconds after being changed).
   */
  updateWidget: (dashboardId: string, widgetInstanceId: string, patch: (widget: WidgetInstance) => WidgetInstance) => Promise<void>
  create: (
    name: string,
    owner?: { ownerProfileId?: string; ownerRole?: string; visibility?: Dashboard['visibility'] },
  ) => Promise<Dashboard>
  duplicate: (id: string, newName: string) => Promise<Dashboard | null>
  rename: (id: string, name: string) => Promise<void>
  /**
   * Refuses to delete the last *public* dashboard - a device with no profile picked (or a
   * profile that owns nothing here) would otherwise be left with nothing it's allowed to
   * show. Private Stations don't count toward, or need protection from, this floor.
   */
  remove: (id: string) => Promise<void>
  /** Throws away every dashboard and re-seeds the defaults. */
  resetToDefaults: () => Promise<void>
  setLayout: (id: string, breakpoint: Breakpoint, layout: LayoutItem[]) => Promise<void>
}

let changesHandle: PouchDB.Core.Changes<Dashboard> | null = null

async function refresh(set: (partial: Partial<DashboardsState>) => void) {
  const docs = await getAllDashboards()
  const dashboards = docs.map(toDashboard).sort(byOrder)
  // Only 'prompter' instances, not every widget on every dashboard - keeps the log focused
  // on what #configDebug's investigation actually needs (Marco, 2026-09-14).
  const prompters = dashboards.flatMap((d) =>
    d.widgets.filter((w) => w.type === 'prompter').map((w) => ({ dashboard: d.id, i: w.i, config: w.config })),
  )
  configLog('refresh() from changes() feed - prompter widget configs now:', prompters)
  set({ dashboards })
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

    changesHandle = dashboardsChanges({ since: 'now', live: true, include_docs: true })
    changesHandle.on('change', () => refresh(set))
  },
  save: async (dashboard) => {
    await putDashboard(dashboard)
  },
  updateWidget: async (dashboardId, widgetInstanceId, patch) => {
    configLog('updateWidget() called for', dashboardId, widgetInstanceId)
    await updateDashboard(dashboardId, (current) => {
      configLog(
        'updateWidget() patch running against freshly-read dashboard, widget configs:',
        current.widgets.map((w) => ({ i: w.i, config: w.config })),
      )
      const next = {
        ...current,
        widgets: current.widgets.map((widget) => (widget.i === widgetInstanceId ? patch(widget) : widget)),
      }
      configLog(
        'updateWidget() patch result, widget configs:',
        next.widgets.map((w) => ({ i: w.i, config: w.config })),
      )
      return next
    })
    configLog('updateWidget() write settled for', dashboardId, widgetInstanceId)
  },
  create: async (name, owner) => {
    const order = get().dashboards.reduce((max, item) => Math.max(max, item.order), -1) + 1
    const dashboard: Dashboard = {
      id: randomId(),
      name,
      order,
      widgets: [],
      layouts: {},
      ownerProfileId: owner?.ownerProfileId,
      ownerRole: owner?.ownerRole,
      visibility: owner?.visibility ?? 'public',
    }
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
    const target = get().dashboards.find((dashboard) => dashboard.id === id)
    if (!target) return
    const publicCount = get().dashboards.filter((dashboard) => dashboard.visibility !== 'private').length
    if (target.visibility !== 'private' && publicCount <= 1) return
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
