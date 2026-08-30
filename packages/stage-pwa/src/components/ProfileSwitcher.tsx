import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Which musician this tablet is showing right now - not a login. Any device can pick any
 * profile from the roster; it exists so a private Station can be told apart from
 * everyone else's, not to gate access. See profile.ts / useActiveProfileStore.ts.
 *
 * Selection only - creating/renaming/reassigning-a-role-to/deleting a roster member moved to
 * SystemView.tsx's "Band" tab (BandManagementView.tsx, 2026-08-30 menu follow-up, at Marco's
 * request), admin-gated there the same way this component used to gate its own +/Bearbeiten/
 * Löschen controls.
 */
export function ProfileSwitcher() {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const profiles = useProfilesStore((state) => state.profiles)
  const activeProfileId = useActiveProfileStore((state) => state.byWorkspace[workspaceId])
  const setActive = useActiveProfileStore((state) => state.setActive)

  return (
    <select
      className="h-12 w-full rounded-sb bg-control px-3 text-base text-ink-soft"
      value={activeProfileId ?? ''}
      onChange={(e) => setActive(workspaceId, e.target.value || null)}
    >
      <option value="">— Kein Profil —</option>
      {profiles.map((profile) => (
        <option key={profile.id} value={profile.id}>
          {profile.name} ({profile.role})
        </option>
      ))}
    </select>
  )
}
