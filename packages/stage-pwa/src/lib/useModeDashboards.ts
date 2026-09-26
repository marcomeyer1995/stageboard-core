import { useMemo } from 'react'
import type { Dashboard, DashboardMode } from 'shared-types'
import { dashboardsForMode, resolveActiveDashboard } from './dashboardLayout'
import { useActiveProfile } from './useActiveProfile'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useAppModeStore } from '../store/useAppModeStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * The dashboards this device can switch between right now (visible to the active profile and
 * offered in the current session mode) and the one it shows - the single place Dashboard.tsx,
 * AppMenu.tsx and the Dashboard-Umschalter widget agree on both, so Gig and Solo Üben each keep
 * their own dashboard list and their own last-used dashboard.
 */
export function useModeDashboards(): { candidates: Dashboard[]; active: Dashboard | undefined; mode: DashboardMode } {
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const mode = useAppModeStore((state) => state.mode)
  const lastShown = useActiveDashboardStore((state) => state.byWorkspace[workspaceId])
  const rememberedForMode = useActiveDashboardStore((state) => state.byWorkspaceMode[workspaceId]?.[mode])
  const activeProfile = useActiveProfile()
  const candidates = useMemo(() => dashboardsForMode(dashboards, activeProfile, mode), [dashboards, activeProfile, mode])
  return { candidates, active: resolveActiveDashboard(candidates, rememberedForMode, lastShown), mode }
}
