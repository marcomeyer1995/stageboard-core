import { useEffect } from 'react'
import { accountMasterIdentity } from './masterTakeover'
import { useActiveProfile } from './useActiveProfile'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Mounted once in App.tsx (#85): keeps the show-state store's master identity in line with the
 * band's master mode - this device in 'device' mode (default), the signed-in person in 'account'
 * mode, so all devices of a bandleader are master together.
 */
export function useMasterIdentity(): void {
  const masterMode = useWorkspaceStore((state) => state.workspaces.find((w) => w.id === state.activeWorkspaceId)?.masterMode)
  const profileId = useActiveProfile()?.id
  const deviceId = useShowStateStore((state) => state.deviceId)
  const setMasterIdentity = useShowStateStore((state) => state.setMasterIdentity)
  const identity = masterMode === 'account' && profileId ? accountMasterIdentity(profileId) : deviceId
  useEffect(() => {
    setMasterIdentity(identity)
  }, [identity, setMasterIdentity])
}
