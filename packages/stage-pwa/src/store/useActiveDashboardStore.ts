import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DashboardMode } from 'shared-types'
import { useAppModeStore } from './useAppModeStore'

interface ActiveDashboardState {
  /** The dashboard this device showed last, in any mode. Keyed by workspace, so switching bands
   * doesn't point at a foreign dashboard. */
  byWorkspace: Record<string, string>
  /** The dashboard last used per session mode (Gig / Solo Üben), so switching modes returns to
   * that mode's own dashboard - see resolveActiveDashboard in dashboardLayout.ts. */
  byWorkspaceMode: Record<string, Partial<Record<DashboardMode, string>>>
  /** Records the choice for the *current* session mode (useAppModeStore). */
  setActive: (workspaceId: string, dashboardId: string) => void
}

/**
 * Which dashboard this tablet currently shows. Deliberately device-local: the dashboards
 * themselves replicate band-wide, but the singer's tablet and the drummer's may sit on
 * different ones (docs/07: "Die App merkt sich pro Endgerät, welche Station zuletzt
 * geladen war") - and since 2026-09-27 per session mode as well.
 */
export const useActiveDashboardStore = create<ActiveDashboardState>()(
  persist(
    (set, get) => ({
      byWorkspace: {},
      byWorkspaceMode: {},
      setActive: (workspaceId, dashboardId) => {
        const mode = useAppModeStore.getState().mode
        const { byWorkspace, byWorkspaceMode } = get()
        set({
          byWorkspace: { ...byWorkspace, [workspaceId]: dashboardId },
          byWorkspaceMode: { ...byWorkspaceMode, [workspaceId]: { ...byWorkspaceMode[workspaceId], [mode]: dashboardId } },
        })
      },
    }),
    {
      name: 'stageboard-active-dashboard',
      version: 1,
      // v0 -> v1: byWorkspaceMode is new; the old last-shown dashboard stays the fallback.
      migrate: (persisted) => {
        const state = persisted as Partial<ActiveDashboardState>
        return { byWorkspace: state.byWorkspace ?? {}, byWorkspaceMode: state.byWorkspaceMode ?? {} } as ActiveDashboardState
      },
    },
  ),
)
