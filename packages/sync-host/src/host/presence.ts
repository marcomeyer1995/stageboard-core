import { MasterHeartbeatReportSchema, PresenceReportSchema, type Presence, type PresenceEntry, type MasterHeartbeat } from 'shared-types'

/**
 * Who is online and who holds the master token, for the one band the tablet serves (host backup, #947,
 * docs/25 §6g) - a port of core-backend's `presenceStore` (#32), reduced to what a show needs: every
 * device's periodic report and the master's heartbeat, pushed as a **full snapshot** on every change
 * (and to a new subscriber at once, so a reconnecting tablet catches up). In memory only: after a
 * restart nobody is known until they report again. Without this a device never gets its master
 * confirmed and cannot press Play.
 */
export interface HostPresence {
  /** A device's report (`POST …/presence/report`): false when the body is no report. */
  report(raw: unknown): boolean
  /** The master's beat (`POST …/master-heartbeat`): false when the body is no beat. */
  heartbeat(raw: unknown): boolean
  snapshot(): Presence
  /** Calls `fn` at once with the current snapshot, and again on every change. Returns the unsubscribe. */
  subscribe(fn: (snapshot: Presence) => void): () => void
}

export function createHostPresence(deps: { now: () => number }): HostPresence {
  const devices = new Map<string, PresenceEntry>()
  let master: MasterHeartbeat | undefined
  const subscribers = new Set<(snapshot: Presence) => void>()
  const snapshot = (): Presence => ({ devices: Object.fromEntries(devices), ...(master ? { masterHeartbeat: master } : {}) })
  const changed = () => {
    const now = snapshot()
    for (const fn of subscribers) fn(now)
  }
  return {
    report(raw) {
      const report = PresenceReportSchema.safeParse(raw)
      if (!report.success) return false
      devices.set(report.data.deviceId, { profileId: report.data.profileId, lastSeenAt: deps.now() })
      changed()
      return true
    },
    heartbeat(raw) {
      const beat = MasterHeartbeatReportSchema.safeParse(raw)
      if (!beat.success) return false
      master = { deviceId: beat.data.deviceId, at: deps.now() }
      changed()
      return true
    },
    snapshot,
    subscribe(fn) {
      subscribers.add(fn)
      fn(snapshot())
      return () => {
        subscribers.delete(fn)
      }
    },
  }
}
