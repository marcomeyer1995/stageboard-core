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

/** Why a device that holds the token may (not) act as master right now (#378, option B). */
export type MasterSelfCheck = 'ok' | 'sync-error' | 'offline' | 'unconfirmed'

/**
 * Self-check for the token holder (#378, option B). The token is a replicated document, so a
 * device whose sync died keeps reading "master = me" while another device took over on the
 * server (Fire, 2026-10-04). A holder therefore only acts as master while
 * - its band sync works (not `error`/`offline`), and
 * - the server confirms it: the latest heartbeat the server stamped is this device's own and
 *   fresh - or it has held the token for less than one timeout (its first beats are underway).
 * Without a Stage-Server at all (a local-only band) there is nothing to confirm against and no
 * other device to take over - the holder always passes.
 */
export function masterSelfCheck(input: {
  syncStatus: 'idle' | 'syncing' | 'offline' | 'error'
  /** Whether this device works with a Stage-Server (false: local-only band). */
  hasStageServer: boolean
  deviceId: string
  heartbeat: MasterHeartbeat | null | undefined
  /** Server time (`getServerTime()`). */
  now: number
  /** Server time at which this device started holding the token (as far as it knows). */
  holdingSince: number
}): MasterSelfCheck {
  const { syncStatus, hasStageServer, deviceId, heartbeat, now, holdingSince } = input
  if (!hasStageServer) return 'ok'
  if (syncStatus === 'error') return 'sync-error'
  if (syncStatus === 'offline') return 'offline'
  if (now - holdingSince <= MASTER_HEARTBEAT_TIMEOUT_MS) return 'ok'
  const confirmed = heartbeat?.deviceId === deviceId && now - heartbeat.at <= MASTER_HEARTBEAT_TIMEOUT_MS
  return confirmed ? 'ok' : 'unconfirmed'
}

/** The identity a master is held under in 'account' mode (#85): the person, not the device. */
export function accountMasterIdentity(profileId: string): string {
  return `profile:${profileId}`
}

/** Profile id from an 'account' master holder id, or null for a device id. */
export function profileIdOfMasterHolder(holderId: string | null): string | null {
  return holderId?.startsWith('profile:') ? holderId.slice('profile:'.length) : null
}
