import type { DeviceInfo, DeviceInfoEntry } from 'shared-types'

type Subscriber = (snapshot: DeviceInfo) => void

/**
 * In-memory, per-workspace "what does the Stage-Server currently know about each device"
 * state - third instance of the same pattern as `presenceStore.ts`/`healthStore.ts` (a
 * heartbeat has no offline/multi-master value, so it doesn't belong in a synced database),
 * keyed by deviceId. Written by every tablet's periodic self-report (`POST
 * /workspaces/:workspaceId/device-info/report` in index.ts) and by `pingLoop.ts`'s background
 * reachability/hostname checks, read from `GET /workspaces/:workspaceId/device-info/stream`.
 *
 * Deliberately not persisted anywhere - same rationale as presenceStore.ts: a fresh restart
 * legitimately doesn't know anything about any device until it hears otherwise again.
 */
const stateByWorkspace = new Map<string, Map<string, DeviceInfoEntry>>()
const subscribersByWorkspace = new Map<string, Set<Subscriber>>()

function snapshotFor(workspaceId: string): DeviceInfo {
  const devices = stateByWorkspace.get(workspaceId)
  return { devices: devices ? Object.fromEntries(devices) : {} }
}

export function getSnapshot(workspaceId: string): DeviceInfo {
  return snapshotFor(workspaceId)
}

function publish(workspaceId: string): void {
  const snapshot = snapshotFor(workspaceId)
  for (const subscriber of subscribersByWorkspace.get(workspaceId) ?? []) {
    subscriber(snapshot)
  }
}

/** Sets one device's entry wholesale and pushes the whole updated snapshot to every subscriber
 * - used by the report handler, which always has a complete entry to write (`ip` stamped from
 * the request, everything else just arrived in the report body). */
export function setEntry(workspaceId: string, deviceId: string, entry: DeviceInfoEntry): void {
  const devices = stateByWorkspace.get(workspaceId) ?? new Map<string, DeviceInfoEntry>()
  devices.set(deviceId, entry)
  stateByWorkspace.set(workspaceId, devices)
  publish(workspaceId)
}

/** Merges a partial update onto an existing entry - used by `pingLoop.ts`, which only ever
 * knows `networkReachable`/`hostname` for a device, not its full entry. A no-op if the device
 * has no entry yet (nothing to merge onto - the next real report will create one). */
export function patchEntry(workspaceId: string, deviceId: string, patch: Partial<DeviceInfoEntry>): void {
  const devices = stateByWorkspace.get(workspaceId)
  const existing = devices?.get(deviceId)
  if (!devices || !existing) return
  devices.set(deviceId, { ...existing, ...patch })
  publish(workspaceId)
}

/**
 * Calls `subscriber` immediately with the current snapshot - same "a reconnecting tablet
 * catches up right away" rationale as presenceStore.ts - then again on every future update for
 * that workspace. Returns an unsubscribe function.
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

/** Every currently-known `(workspaceId, deviceId, ip)` triple - what `pingLoop.ts` iterates
 * each tick. */
export function allEntries(): { workspaceId: string; deviceId: string; ip: string }[] {
  const result: { workspaceId: string; deviceId: string; ip: string }[] = []
  for (const [workspaceId, devices] of stateByWorkspace) {
    for (const [deviceId, entry] of devices) {
      result.push({ workspaceId, deviceId, ip: entry.ip })
    }
  }
  return result
}

/** Test-only: this module's state is shared across the whole process by design (one server,
 * many workspaces) - tests need a way to reset it between runs. */
export function __resetDeviceInfoStoreForTests(): void {
  stateByWorkspace.clear()
  subscribersByWorkspace.clear()
}
