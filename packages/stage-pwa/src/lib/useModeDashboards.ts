import { useMemo } from 'react'
import type { Dashboard, DashboardMode } from 'shared-types'
import { dashboardsForMode, resolveActiveDashboard } from './dashboardLayout'
import { useActiveProfile } from './useActiveProfile'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useAppModeStore } from '../store/useAppModeStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { inMenuOrder, useDashboardMenuStore } from '../store/useDashboardMenuStore'

const EMPTY: string[] = []

/**
 * The dashboards this device can switch between right now (visible to the active profile and
 * offered in the current session mode) and the one it shows - the single place Dashboard.tsx,
 * AppMenu.tsx and the Dashboard-Umschalter widget agree on both, so Gig and Solo Üben each keep
 * their own dashboard list and their own last-used dashboard. In this device's own order, without
 * the ones hidden here (useDashboardMenuStore).
 */
export function useModeDashboards(): {
  candidates: Dashboard[]
  active: Dashboard | undefined
  mode: DashboardMode
  /** Every dashboard of this mode in this device's order, hidden ones included (menu "Ordnen"). */
  listed: Dashboard[]
  hidden: string[]
} {
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const mode = useAppModeStore((state) => state.mode)
  const lastShown = useActiveDashboardStore((state) => state.byWorkspace[workspaceId])
  const rememberedForMode = useActiveDashboardStore((state) => state.byWorkspaceMode[workspaceId]?.[mode])
  const activeProfile = useActiveProfile()
  const prefs = useDashboardMenuStore((state) => state.byWorkspace[workspaceId])
  const listed = useMemo(() => inMenuOrder(dashboardsForMode(dashboards, activeProfile, mode), prefs?.order ?? []), [dashboards, activeProfile, mode, prefs?.order])
  const hidden = prefs?.hidden ?? EMPTY
  // Hidden on this device = not offered here; with everything hidden the full list stays.
  const candidates = useMemo(() => {
    const shown = listed.filter((d) => !hidden.includes(d.id))
    return shown.length ? shown : listed
  }, [listed, hidden])
  // A dashboard hidden here can still be edited (menu "Bearbeiten" → pen): while editing it stays
  // the shown one instead of falling back to the first visible (Marco, 2026-10-07).
  const editing = useEditModeStore((state) => state.isEditing)
  return { candidates, active: resolveActiveDashboard(editing ? listed : candidates, rememberedForMode, lastShown), mode, listed, hidden }
}
