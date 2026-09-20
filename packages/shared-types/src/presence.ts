import { z } from 'zod'

export const PresenceEntrySchema = z.object({
  profileId: z.string().min(1),
  /** Epoch ms of the last heartbeat. Stale means offline - see PRESENCE_TIMEOUT_MS. */
  lastSeenAt: z.number().int().nonnegative(),
})
export type PresenceEntry = z.infer<typeof PresenceEntrySchema>

/** Last beat seen from whichever device holds the Master-Token (#32). `at` is stamped
 * server-side on receipt, so readers compare it against `getServerTime()` rather than their
 * own clock. */
export const MasterHeartbeatSchema = z.object({
  deviceId: z.string().min(1),
  at: z.number().int().nonnegative(),
})
export type MasterHeartbeat = z.infer<typeof MasterHeartbeatSchema>

/** The Master-Token holder beats this often (#32)... */
export const MASTER_HEARTBEAT_INTERVAL_MS = 5_000
/** ...and counts as gone (token treated as released) after this long without one. */
export const MASTER_HEARTBEAT_TIMEOUT_MS = 15_000

export const MasterHeartbeatReportSchema = z.object({ deviceId: z.string().min(1) })
export type MasterHeartbeatReport = z.infer<typeof MasterHeartbeatReportSchema>

/**
 * Runtime "who's currently logged in, from how many devices" for one workspace - written by
 * every tablet that has an active profile, read by every tablet's BandManagementView.tsx.
 * Keyed by deviceId, not profileId: the whole point is telling apart "one device online" from
 * "the same account open on three tablets at once", something a single per-profile flag
 * couldn't represent. Same pattern as PluginHealth (pluginHealth.ts) - a heartbeat has no
 * offline/multi-master value, so it doesn't belong in synced CouchDB docs either.
 */
/** Who has answered the currently open Ready Check (#60). `checkId` is ShowState.readyCheckId at the
 * time - readers ignore a snapshot whose id is not the one ShowState currently names. */
export const ReadyCheckSchema = z.object({
  checkId: z.string().min(1),
  readyProfileIds: z.array(z.string()),
})
export type ReadyCheck = z.infer<typeof ReadyCheckSchema>

/** Body a tablet POSTs to say "this profile is ready" for a Ready Check. */
export const ReadyReportSchema = z.object({ checkId: z.string().min(1), profileId: z.string().min(1) })
export type ReadyReport = z.infer<typeof ReadyReportSchema>

export const PresenceSchema = z.object({
  devices: z.record(z.string(), PresenceEntrySchema).default({}),
  readyCheck: ReadyCheckSchema.nullable().optional(),
  /** The Master-Token holder's liveness (#32) - rides on this same SSE snapshot instead of a
   * stream of its own, since this app already sits near Chrome's per-origin connection cap. */
  masterHeartbeat: MasterHeartbeatSchema.nullable().optional(),
})
export type Presence = z.infer<typeof PresenceSchema>

export const DEFAULT_PRESENCE: Presence = { devices: {} }

/** How long a heartbeat stays valid - see PluginHealth's identical HEALTH_TIMEOUT_MS. Longer
 * than that one: which profile is active is far less time-critical than hardware reachability,
 * and every logged-in tablet reports here, not just one Stage-Server, so a longer interval
 * keeps the aggregate report traffic modest for a full band. */
export const PRESENCE_TIMEOUT_MS = 30_000

/** Body a tablet POSTs to report itself as "this device is currently signed in as this
 * profile" - `deviceId` is a random id the tablet generates once and keeps (`deviceId.ts`),
 * not tied to any account. `lastSeenAt` is stamped server-side on receipt, not supplied by the
 * reporting tablet. */
export const PresenceReportSchema = z.object({
  deviceId: z.string().min(1),
  profileId: z.string().min(1),
})
export type PresenceReport = z.infer<typeof PresenceReportSchema>
