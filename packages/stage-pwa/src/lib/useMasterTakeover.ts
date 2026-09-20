import { getServerTime } from './clockSync'
import { canClaimMaster, getMasterStatus, type MasterStatus } from './masterTakeover'
import { useActiveProfile } from './useActiveProfile'
import { useNow } from './useNow'
import { useDialogStore } from '../store/useDialogStore'
import { usePresenceStore } from '../store/usePresenceStore'
import { useShowStateStore } from '../store/useShowStateStore'

export interface MasterTakeover {
  status: MasterStatus
  /** Whether this device's active profile may claim right now (never true for `self`). */
  canClaim: boolean
  /** True when claiming means taking the token from a live master - asks for confirmation. */
  isForce: boolean
  claim: () => Promise<void>
}

/** Master-Token claim rules (#32) shared by every "Master übernehmen" button. */
export function useMasterTakeover(): MasterTakeover {
  const deviceId = useShowStateStore((state) => state.deviceId)
  const holderId = useShowStateStore((state) => state.state.masterHolderId)
  const claimMaster = useShowStateStore((state) => state.claimMaster)
  const heartbeat = usePresenceStore((state) => state.presence.masterHeartbeat)
  const roles = useActiveProfile()?.stageRoles ?? []
  const confirm = useDialogStore((state) => state.confirm)
  // A heartbeat going stale is the absence of an event, so re-evaluate on a timer.
  useNow(2_000)

  const status = getMasterStatus({ holderId, deviceId, heartbeat, now: getServerTime() })
  const canClaim = canClaimMaster(status, roles)
  const isForce = status === 'alive'

  const claim = async () => {
    if (!canClaim) return
    if (isForce && !(await confirm('Das aktive Master-Gerät wirklich verdrängen?', { title: 'Force Takeover', confirmLabel: 'Übernehmen', danger: true }))) {
      return
    }
    await claimMaster()
  }

  return { status, canClaim, isForce, claim }
}
