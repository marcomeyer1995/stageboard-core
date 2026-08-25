import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ActiveDashboardState {
  /** Keyed by workspace, so switching bands doesn't point at a foreign dashboard. */
  byWorkspace: Record<string, string>
  setActive: (workspaceId: string, dashboardId: string) => void
}

/**
 * Which dashboard this tablet currently shows. Deliberately device-local: the dashboards
 * themselves replicate band-wide, but the singer's tablet and the drummer's may sit on
 * different ones (docs/07: "Die App merkt sich pro Endgerät, welche Station zuletzt
 * geladen war").
 */
export const useActiveDashboardStore = create<ActiveDashboardState>()(
  persist(
    (set, get) => ({
      byWorkspace: {},
      setActive: (workspaceId, dashboardId) =>
        set({ byWorkspace: { ...get().byWorkspace, [workspaceId]: dashboardId } }),
    }),
    { name: 'stageboard-active-dashboard' },
  ),
)
