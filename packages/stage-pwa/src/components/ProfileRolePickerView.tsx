import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { BackToWorkingBandLink } from './BackToWorkingBandLink'

/**
 * Shown by App.tsx instead of the Dashboard once the active workspace has credentials but no
 * profile is chosen for it yet (see #21's "Profile + role for today" goal) - the second half
 * of onboarding a fresh device, right after JoinBandView. Picking a card is exactly
 * ProfileSwitcher.tsx's existing `setActive`, just as a full-screen grid instead of a menu
 * dropdown; the choice persists (useActiveProfileStore), so this only ever shows again if
 * explicitly cleared from the menu.
 *
 * Per #21's rework note: a `Profile`'s `role` is still one fixed field on the roster entry
 * (#56) - picking a different role per session (not just per profile) is a separate,
 * deliberately deferred data-model question, not built here.
 */
export function ProfileRolePickerView() {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const profiles = useProfilesStore((state) => state.profiles)
  const setActive = useActiveProfileStore((state) => state.setActive)

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-6 overflow-y-auto sb-app-bg p-4 text-ink">
      <div className="w-full max-w-sm py-4">
        <BackToWorkingBandLink />

        <h1 className="text-2xl font-bold">Wer bist du?</h1>
        <p className="mt-1 text-sm text-ink-muted">Kein Login - wähle dein Profil aus der Band-Liste.</p>

        <div className="mt-4 space-y-2">
          {profiles.length === 0 && (
            <p className="text-sm text-ink-faint">Noch keine Profile angelegt - ein Admin kann welche im Menü anlegen.</p>
          )}
          {profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              onClick={() => setActive(workspaceId, profile.id)}
              className="flex w-full items-center justify-between rounded-sb border border-line bg-surface px-4 py-3 text-left hover:bg-control-hover"
            >
              <span className="font-semibold">{profile.name}</span>
              <span className="text-sm text-ink-muted">{profile.role}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setActive(workspaceId, null)}
          className="mt-4 w-full rounded-sb bg-control px-4 py-2 text-sm text-ink-soft hover:bg-control-hover"
        >
          Ohne Profil fortfahren
        </button>
      </div>
    </div>
  )
}
