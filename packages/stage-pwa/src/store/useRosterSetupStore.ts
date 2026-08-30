import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface RosterSetupState {
  /** Keyed by workspace - true once this workspace's admin has explicitly gone through
   * RosterSetupView.tsx (its "Weiter" button), not just "roster happens to be non-empty".
   * Deliberately not derived from `profiles.length > 0`: an admin adding several roster
   * members in one sitting shouldn't get bumped to the next screen after just the first one. */
  completedFor: Record<string, boolean>
  complete: (workspaceId: string) => void
}

/**
 * Tracks whether this device (as a workspace's admin, see #56) has finished the one-time
 * "build the roster" step shown right after founding a band (RosterSetupView.tsx) - separate
 * from useActiveProfileStore.ts, which tracks *which* profile is active, not whether roster
 * setup itself has been done.
 */
export const useRosterSetupStore = create<RosterSetupState>()(
  persist(
    (set, get) => ({
      completedFor: {},
      complete: (workspaceId) => set({ completedFor: { ...get().completedFor, [workspaceId]: true } }),
    }),
    { name: 'stageboard-roster-setup' },
  ),
)
