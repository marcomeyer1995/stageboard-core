import { useEffect, useRef } from 'react'
import { useHostUrlStore } from '../store/useHostUrlStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { ownAdminCheckFor } from './ownAdminCheck'
import { useActiveProfile } from './useActiveProfile'

/** Keeps this device's own admin gate in step with the roster - see ownAdminCheck.ts (#978). */
export function useOwnAdminSync(): void {
  const workspace = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId))
  const hostUrl = useHostUrlStore((state) => state.url)
  const me = useActiveProfile()
  const profileId = ownAdminCheckFor(workspace, me)
  const rosterAdmin = me?.stageRoles.includes('admin') ?? false
  // One try per change of the roster's answer (and per host) - a host that disagrees is not asked in a loop.
  const asked = useRef<string | null>(null)

  useEffect(() => {
    if (!profileId || !workspace) return
    const key = `${workspace.id}:${profileId}:${rosterAdmin}:${hostUrl}`
    if (asked.current === key) return
    asked.current = key
    void useWorkspaceStore.getState().activateProfile(workspace.id, profileId, undefined, { silent: true })
  }, [profileId, workspace, hostUrl, rosterAdmin])
}
