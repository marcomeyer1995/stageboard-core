import { PRESENCE_TIMEOUT_MS, type Presence } from 'shared-types'

export interface ReadyStatus {
  /** Profiles that must answer: signed in on a device seen within PRESENCE_TIMEOUT_MS. */
  total: number
  ready: number
  /** Profiles that still have to answer. */
  missingProfileIds: string[]
  allReady: boolean
}

/**
 * The state of the Ready Check with id `checkId` (#60), derived from the presence snapshot.
 * Counted per PROFILE, not per device: two tablets signed in as the same person are one
 * musician, and one tap from either covers both. A profile whose devices have all gone silent
 * (not seen for PRESENCE_TIMEOUT_MS) is not physically waiting anywhere, so it never blocks.
 * `now` is server time, since `lastSeenAt` is stamped by the server.
 *
 * With nobody online there is nothing to wait for, which is not the same as "everyone is
 * ready" - `allReady` stays false so an empty check never auto-completes.
 */
export function computeReadyStatus(presence: Presence, checkId: string, now: number): ReadyStatus {
  const active = new Set<string>()
  for (const entry of Object.values(presence.devices)) {
    if (now - entry.lastSeenAt <= PRESENCE_TIMEOUT_MS) active.add(entry.profileId)
  }
  // Answers only count for the check that is actually open: a leftover snapshot from an earlier
  // check (different id) says nothing about this one.
  const answered = new Set(presence.readyCheck?.checkId === checkId ? presence.readyCheck.readyProfileIds : [])
  const missingProfileIds = [...active].filter((profileId) => !answered.has(profileId))
  const total = active.size
  return {
    total,
    ready: total - missingProfileIds.length,
    missingProfileIds,
    allReady: total > 0 && missingProfileIds.length === 0,
  }
}

/** Whether `profileId` has already answered check `checkId`. */
export function hasAnswered(presence: Presence, checkId: string, profileId: string | undefined): boolean {
  return profileId !== undefined && presence.readyCheck?.checkId === checkId && presence.readyCheck.readyProfileIds.includes(profileId)
}
