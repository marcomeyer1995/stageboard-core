import type { FlashMessage, MasterHeartbeat, Presence, PresenceEntry, ReadyCheck } from 'shared-types'

/**
 * Who is online, who holds the master token, the open Ready Check and the latest Stage-Messenger message, per
 * band (host module, #949): the one presence store both hosts use - the laptop's Host (several bands) and
 * the tablet's app (the one it serves). Every change is pushed as a **full snapshot** to every subscriber of the
 * band, and a new subscriber gets the current one at once, so a reconnecting tablet catches up and no one needs
 * merge logic. In memory only: a heartbeat has no value offline, and after a restart nobody is known until they
 * report again.
 */
export interface HostPresence {
  /** A device's periodic report: the profile it is signed in as, stamped with this host's time. */
  setEntry(workspaceId: string, deviceId: string, profileId: string): void
  /** The master token holder's beat - one slot per band, since only one device is master at a time. */
  setMasterHeartbeat(workspaceId: string, deviceId: string): void
  /** `profileId` is ready for Ready Check `checkId`. A report for another id starts a fresh check: the previous
   * check's answers must never count towards a new one. */
  setReady(workspaceId: string, checkId: string, profileId: string): void
  /** A message for every device of the band; `to` (profile ids) narrows who shows it - everyone gets it, only the
   * addressed ones display it. Replaces the one before. */
  setFlash(workspaceId: string, text: string, from: string | undefined, to?: string[]): FlashMessage
  snapshot(workspaceId: string): Presence
  /** Calls `fn` at once with the current snapshot, and again on every change of the band. Returns the unsubscribe. */
  subscribe(workspaceId: string, fn: (snapshot: Presence) => void): () => void
}

export function createHostPresence(deps: { now: () => number; newId?: () => string }): HostPresence {
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const devices = new Map<string, Map<string, PresenceEntry>>()
  const masters = new Map<string, MasterHeartbeat>()
  const readyChecks = new Map<string, { checkId: string; ready: Set<string> }>()
  const flashes = new Map<string, FlashMessage>()
  const subscribers = new Map<string, Set<(snapshot: Presence) => void>>()

  const readyCheck = (workspaceId: string): ReadyCheck | undefined => {
    const check = readyChecks.get(workspaceId)
    return check ? { checkId: check.checkId, readyProfileIds: [...check.ready] } : undefined
  }
  const snapshot = (workspaceId: string): Presence => {
    const master = masters.get(workspaceId)
    const check = readyCheck(workspaceId)
    const flash = flashes.get(workspaceId)
    return {
      devices: Object.fromEntries(devices.get(workspaceId) ?? []),
      ...(master ? { masterHeartbeat: master } : {}),
      ...(check ? { readyCheck: check } : {}),
      ...(flash ? { flash } : {}),
    }
  }
  const changed = (workspaceId: string) => {
    const now = snapshot(workspaceId)
    for (const fn of subscribers.get(workspaceId) ?? []) fn(now)
  }

  return {
    setEntry(workspaceId, deviceId, profileId) {
      const band = devices.get(workspaceId) ?? new Map<string, PresenceEntry>()
      band.set(deviceId, { profileId, lastSeenAt: deps.now() })
      devices.set(workspaceId, band)
      changed(workspaceId)
    },
    setMasterHeartbeat(workspaceId, deviceId) {
      masters.set(workspaceId, { deviceId, at: deps.now() })
      changed(workspaceId)
    },
    setReady(workspaceId, checkId, profileId) {
      const existing = readyChecks.get(workspaceId)
      const check = existing?.checkId === checkId ? existing : { checkId, ready: new Set<string>() }
      check.ready.add(profileId)
      readyChecks.set(workspaceId, check)
      changed(workspaceId)
    },
    setFlash(workspaceId, text, from, to) {
      const flash: FlashMessage = { id: newId(), text, from, ...(to && to.length ? { to } : {}), at: deps.now() }
      flashes.set(workspaceId, flash)
      changed(workspaceId)
      return flash
    },
    snapshot,
    subscribe(workspaceId, fn) {
      const set = subscribers.get(workspaceId) ?? new Set<(snapshot: Presence) => void>()
      set.add(fn)
      subscribers.set(workspaceId, set)
      fn(snapshot(workspaceId))
      return () => {
        set.delete(fn)
      }
    },
  }
}
