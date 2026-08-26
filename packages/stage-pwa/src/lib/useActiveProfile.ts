import type { Profile } from 'shared-types'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { useProfilesStore } from '../store/useProfilesStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/** Which Profile (if any) this tablet is currently showing, for the active workspace. */
export function useActiveProfile(): Profile | undefined {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const profiles = useProfilesStore((state) => state.profiles)
  const activeProfileId = useActiveProfileStore((state) => state.byWorkspace[workspaceId])
  return profiles.find((profile) => profile.id === activeProfileId)
}
