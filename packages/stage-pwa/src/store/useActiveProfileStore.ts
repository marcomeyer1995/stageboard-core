import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ActiveProfileState {
  /** Keyed by workspace, so switching bands doesn't point at a foreign profile. A missing key
   * means "never decided yet" (see #21 - ProfileRolePickerView.tsx's gate in App.tsx keys off
   * exactly this); an empty string means "explicitly chose no profile", which is different -
   * both `setActive(id, null)` (the dropdown's "— Kein Profil —") and picking "Ohne Profil
   * fortfahren" on the picker screen produce the empty string, not a deleted key, precisely so
   * that choice sticks instead of re-showing the picker on the next reload. */
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
        set({ byWorkspace: { ...get().byWorkspace, [workspaceId]: profileId ?? '' } })
      },
    }),
    { name: 'stageboard-active-profile' },
  ),
)
