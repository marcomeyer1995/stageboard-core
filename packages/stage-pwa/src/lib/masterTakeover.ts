import { MASTER_HEARTBEAT_TIMEOUT_MS, type MasterHeartbeat, type StageRole } from 'shared-types'

/**
 * Where the Master-Token stands from this tablet's point of view (#32):
 * - `self`: this device holds it.
 * - `vacant`: nobody holds it.
 * - `alive`: another device holds it and its heartbeat is fresh.
 * - `stale`: another device holds it but hasn't beaten for MASTER_HEARTBEAT_TIMEOUT_MS - dead
 *   or off the network, so the token counts as released.
 */
export type MasterStatus = 'self' | 'vacant' | 'alive' | 'stale'

/** Roles that may force-take the token from a live master. Deliberately not `crew`. */
export const FORCE_TAKEOVER_ROLES: readonly StageRole[] = ['admin', 'showmaster']

export function getMasterStatus(input: {
  holderId: string | null
  deviceId: string
  heartbeat: MasterHeartbeat | null | undefined
  /** Server time (`getServerTime()`), since the heartbeat's `at` is stamped by the server. */
  now: number
}): MasterStatus {
  const { holderId, deviceId, heartbeat, now } = input
  if (!holderId) return 'vacant'
  if (holderId === deviceId) return 'self'
  // A beat from a device that is no longer the holder (an old master's last one arriving after
  // a handover) says nothing about the current holder.
  const fresh = heartbeat?.deviceId === holderId && now - heartbeat.at <= MASTER_HEARTBEAT_TIMEOUT_MS
  return fresh ? 'alive' : 'stale'
}

/** A vacant/stale token can be claimed by anyone; a live one only by a force-takeover role. */
export function canClaimMaster(status: MasterStatus, roles: readonly StageRole[]): boolean {
  if (status === 'self') return false
  if (status !== 'alive') return true
  return roles.some((role) => FORCE_TAKEOVER_ROLES.includes(role))
}
