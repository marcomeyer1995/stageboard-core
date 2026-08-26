import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ActiveProfileState {
  /** Keyed by workspace, so switching bands doesn't point at a foreign profile. */
  byWorkspace: Record<string, string>
  setActive: (workspaceId: string, profileId: string | null) => void
}

/**
 * Which profile this tablet is currently "signed in" as. Deliberately device-local and
 * not authentication - the roster itself (Profile) replicates band-wide, but which one a
 * given tablet is showing right now, if any, is a local choice, same pattern as
 * useActiveDashboardStore.
 */
export const useActiveProfileStore = create<ActiveProfileState>()(
  persist(
    (set, get) => ({
      byWorkspace: {},
      setActive: (workspaceId, profileId) => {
        const byWorkspace = { ...get().byWorkspace }
        if (profileId) byWorkspace[workspaceId] = profileId
        else delete byWorkspace[workspaceId]
        set({ byWorkspace })
      },
    }),
    { name: 'stageboard-active-profile' },
  ),
)
