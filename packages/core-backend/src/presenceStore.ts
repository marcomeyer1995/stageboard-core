import type { MasterHeartbeat, Presence, PresenceEntry, ReadyCheck } from 'shared-types'

type Subscriber = (snapshot: Presence) => void

/**
 * In-memory, per-workspace "who's currently logged in, from how many devices" state - same
 * pattern as plugins/healthStore.ts (a heartbeat has no offline/multi-master value, so it
 * doesn't belong in a synced database), just keyed by deviceId instead of plugin name. Written
 * by every tablet's periodic self-report (`POST /workspaces/:workspaceId/presence/report` in
 * index.ts) and read from `GET /workspaces/:workspaceId/presence/stream`.
 *
 * Deliberately not persisted anywhere: a fresh restart legitimately doesn't know anyone is
 * online until it hears otherwise again - same behavior as before, just not backed by disk.
 */
const stateByWorkspace = new Map<string, Map<string, PresenceEntry>>()
const masterHeartbeatByWorkspace = new Map<string, MasterHeartbeat>()
/** The open Ready Check's answers (#60), one slot per workspace. Kept as a Set while running. */
const readyCheckByWorkspace = new Map<string, { checkId: string; readyProfileIds: Set<string> }>()
const subscribersByWorkspace = new Map<string, Set<Subscriber>>()

function readyCheckSnapshot(workspaceId: string): ReadyCheck | undefined {
  const check = readyCheckByWorkspace.get(workspaceId)
  return check ? { checkId: check.checkId, readyProfileIds: [...check.readyProfileIds] } : undefined
}

function snapshotFor(workspaceId: string): Presence {
  const devices = stateByWorkspace.get(workspaceId)
  return {
    devices: devices ? Object.fromEntries(devices) : {},
    masterHeartbeat: masterHeartbeatByWorkspace.get(workspaceId),
    readyCheck: readyCheckSnapshot(workspaceId),
  }
}

export function getSnapshot(workspaceId: string): Presence {
  return snapshotFor(workspaceId)
}

/** Sets one device's entry and pushes the whole updated snapshot to every subscriber - a
 * full snapshot, not a delta, so subscribers never need merge logic (the payload is tiny: a
 * handful of devices at most). */
export function setEntry(workspaceId: string, deviceId: string, entry: PresenceEntry): void {
  const devices = stateByWorkspace.get(workspaceId) ?? new Map<string, PresenceEntry>()
  devices.set(deviceId, entry)
  stateByWorkspace.set(workspaceId, devices)

  const snapshot = snapshotFor(workspaceId)
  for (const subscriber of subscribersByWorkspace.get(workspaceId) ?? []) {
    subscriber(snapshot)
  }
}

/** Records the Master-Token holder's latest beat (#32) - one slot per workspace, since only
 * one device is master at a time - and pushes the snapshot like setEntry does. */
export function setMasterHeartbeat(workspaceId: string, deviceId: string): void {
  masterHeartbeatByWorkspace.set(workspaceId, { deviceId, at: Date.now() })

  const snapshot = snapshotFor(workspaceId)
  for (const subscriber of subscribersByWorkspace.get(workspaceId) ?? []) {
    subscriber(snapshot)
  }
}

/** Records that `profileId` is ready for Ready Check `checkId` (#60) and pushes the snapshot. A
 * report for a different id than the stored one starts a fresh check - the previous check's
 * answers must never count towards a new one. */
export function setReady(workspaceId: string, checkId: string, profileId: string): void {
  const existing = readyCheckByWorkspace.get(workspaceId)
  const check = existing?.checkId === checkId ? existing : { checkId, readyProfileIds: new Set<string>() }
  check.readyProfileIds.add(profileId)
  readyCheckByWorkspace.set(workspaceId, check)

  const snapshot = snapshotFor(workspaceId)
  for (const subscriber of subscribersByWorkspace.get(workspaceId) ?? []) {
    subscriber(snapshot)
  }
}

/**
 * Calls `subscriber` immediately with the current snapshot - this is what makes a
 * reconnecting tablet catch up right away instead of waiting for the next change - then
 * again on every future update for that workspace. Returns an unsubscribe function.
 */
export function subscribe(workspaceId: string, subscriber: Subscriber): () => void {
  const subscribers = subscribersByWorkspace.get(workspaceId) ?? new Set<Subscriber>()
  subscribers.add(subscriber)
  subscribersByWorkspace.set(workspaceId, subscribers)
  subscriber(snapshotFor(workspaceId))

  return () => {
    subscribers.delete(subscriber)
  }
}

/** Test-only: this module's state is shared across the whole process by design (one server,
 * many workspaces) - tests need a way to reset it between runs. */
export function __resetPresenceStoreForTests(): void {
  stateByWorkspace.clear()
  masterHeartbeatByWorkspace.clear()
  readyCheckByWorkspace.clear()
  subscribersByWorkspace.clear()
}
