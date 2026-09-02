import { z } from 'zod'

export const PresenceEntrySchema = z.object({
  profileId: z.string().min(1),
  /** Epoch ms of the last heartbeat. Stale means offline - see PRESENCE_TIMEOUT_MS. */
  lastSeenAt: z.number().int().nonnegative(),
})
export type PresenceEntry = z.infer<typeof PresenceEntrySchema>

/**
 * Runtime "who's currently logged in, from how many devices" for one workspace - written by
 * every tablet that has an active profile, read by every tablet's BandManagementView.tsx.
 * Keyed by deviceId, not profileId: the whole point is telling apart "one device online" from
 * "the same account open on three tablets at once", something a single per-profile flag
 * couldn't represent. Same pattern as PluginHealth (pluginHealth.ts) - a heartbeat has no
 * offline/multi-master value, so it doesn't belong in synced CouchDB docs either.
 */
export const PresenceSchema = z.object({
  devices: z.record(z.string(), PresenceEntrySchema).default({}),
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
