import type { DeviceInfo, DeviceInfoEntry, DeviceInfoReport } from 'shared-types'

/**
 * What a host knows about each device of a band (the Device Ledger, host module #949): the report every device
 * sends every few seconds, plus what the host finds out about it on its own (is it reachable on the network, its
 * name - the laptop's ping loop; a platform that cannot ping leaves both `null`). One store both hosts use. In
 * memory only: a restart legitimately knows nothing about any device until it hears from it again, which is also
 * why a snapshot says since when this host has been collecting (until every device had time to report, a missing
 * report says nothing).
 */
export interface HostDeviceInfo {
  /** A device's own report: the host stamps the sender's address and the time. What the ping loop found out
   * about the device before (`networkReachable`, `hostname`) is kept - the device knows neither. */
  report(workspaceId: string, report: DeviceInfoReport, ip: string | undefined): void
  /** One device's entry, set wholesale. */
  setEntry(workspaceId: string, deviceId: string, entry: DeviceInfoEntry): void
  /** Merges a partial update onto an existing entry (the ping loop knows only `networkReachable`/`hostname`); a
   * no-op for a device without an entry - the next real report makes one. */
  patchEntry(workspaceId: string, deviceId: string, patch: Partial<DeviceInfoEntry>): void
  snapshot(workspaceId: string): DeviceInfo
  /** At once with the current snapshot, and again on every change of the band. Returns the unsubscribe. */
  subscribe(workspaceId: string, fn: (snapshot: DeviceInfo) => void): () => void
  /** Every known (band, device, address) - what a ping loop walks through. */
  allEntries(): { workspaceId: string; deviceId: string; ip: string }[]
}

export function createHostDeviceInfo(deps: { now: () => number }): HostDeviceInfo {
  const collectingSince = deps.now()
  const bands = new Map<string, Map<string, DeviceInfoEntry>>()
  const subscribers = new Map<string, Set<(snapshot: DeviceInfo) => void>>()

  const snapshot = (workspaceId: string): DeviceInfo => ({ devices: Object.fromEntries(bands.get(workspaceId) ?? []), collectingSince })
  const publish = (workspaceId: string) => {
    const now = snapshot(workspaceId)
    for (const fn of subscribers.get(workspaceId) ?? []) fn(now)
  }
  const setEntry = (workspaceId: string, deviceId: string, entry: DeviceInfoEntry) => {
    const band = bands.get(workspaceId) ?? new Map<string, DeviceInfoEntry>()
    band.set(deviceId, entry)
    bands.set(workspaceId, band)
    publish(workspaceId)
  }

  return {
    report(workspaceId, report, ip) {
      const before = bands.get(workspaceId)?.get(report.deviceId)
      setEntry(workspaceId, report.deviceId, {
        ip: ip ?? 'unknown',
        os: report.os,
        environment: report.environment,
        syncStatus: report.syncStatus,
        lastSeenAt: deps.now(),
        networkReachable: before?.networkReachable ?? null,
        hostname: before?.hostname ?? null,
        audioOutput: report.audioOutput ?? null,
        vitals: report.vitals ?? null,
        leadNeededMs: report.leadNeededMs ?? null,
        battery: report.battery ?? null,
        midiOutputs: report.midiOutputs ?? null,
        silenced: report.silenced ?? null,
        foreground: report.foreground ?? null,
      })
    },
    setEntry,
    patchEntry(workspaceId, deviceId, patch) {
      const band = bands.get(workspaceId)
      const existing = band?.get(deviceId)
      if (!band || !existing) return
      band.set(deviceId, { ...existing, ...patch })
      publish(workspaceId)
    },
    snapshot,
    subscribe(workspaceId, fn) {
      const set = subscribers.get(workspaceId) ?? new Set<(snapshot: DeviceInfo) => void>()
      set.add(fn)
      subscribers.set(workspaceId, set)
      fn(snapshot(workspaceId))
      return () => {
        set.delete(fn)
      }
    },
    allEntries() {
      const out: { workspaceId: string; deviceId: string; ip: string }[] = []
      for (const [workspaceId, band] of bands) for (const [deviceId, entry] of band) out.push({ workspaceId, deviceId, ip: entry.ip })
      return out
    },
  }
}
