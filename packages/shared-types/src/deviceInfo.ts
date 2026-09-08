import { z } from 'zod'

/**
 * Runtime, per-device diagnostic info for the Device Ledger (DeviceLedgerView.tsx, Marco's
 * explicit request) - "first point to check stuff if something is not properly running."
 * Deliberately its own ephemeral store/stream, not folded into Presence (presence.ts): Presence
 * is specifically "who's signed in as whom" and is deliberately gated on a real profile being
 * active (usePresenceReporter.ts's own doc comment) - a device with no profile chosen yet still
 * needs to show up here, and none of these fields (IP, OS, environment, sync status) have
 * anything to do with which profile, if any, is active. Same "a heartbeat has no offline/
 * multi-master value, so it doesn't belong in a synced doc" reasoning as presence.ts and
 * plugin.ts's PluginHealth - this is the third instance of that one template, not a new one.
 */
export const DeviceInfoEntrySchema = z.object({
  /** Stamped server-side from the TCP connection (Fastify's `request.ip`) on every report -
   * never trusted from the client, which can't reliably know its own LAN IP anyway. */
  ip: z.string().min(1),
  /** Coarse device-class label, client-supplied (stage-pwa's `guessDeviceName()` - already the
   * right granularity, reused as-is rather than writing a second parser). */
  os: z.string().min(1),
  /** Browser tab, installed PWA (`display-mode: standalone`), or a native wrapper
   * (`window.Capacitor`) - stage-pwa's `detectEnvironment.ts`. */
  environment: z.enum(['browser', 'pwa', 'native']),
  /** This device's own aggregate PouchDB sync state right now - stage-pwa's `useSyncStore.ts`
   * `deriveSyncStatus()`, already computed for the sync indicator elsewhere in the app. */
  syncStatus: z.enum(['idle', 'syncing', 'offline', 'error']),
  /** Epoch ms of the last report - stamped server-side, same convention as Presence. Staleness
   * (see DEVICE_INFO_TIMEOUT_MS) is this entry's "is the app open" signal. */
  lastSeenAt: z.number().int().nonnegative(),
  /** Whether the Stage-Server's own background ping (core-backend's pingLoop.ts) most recently
   * reached this device's `ip` - `null` until the first ping tick runs. Deliberately a separate
   * signal from `lastSeenAt`'s "is the app open" (Marco, explicit request): a device can be
   * network-reachable with the app closed, or app-open-stale while still on the network (or
   * vice versa if it just changed IP) - conflating them would hide exactly the distinction a
   * technician needs. Caveat worth knowing when reading this: a screen-locked tablet's WiFi
   * radio can go quiet even when the device itself is fine, so a `false` here is "no network
   * response right now," not a hard verdict that the device is broken. */
  networkReachable: z.boolean().nullable(),
  /** Best-effort reverse-DNS of `ip` (pingLoop.ts, `node:dns`'s `reverse()`) - a display nicety
   * only, `null` whenever the LAN doesn't have a reverse-DNS record for it, which is the common
   * case on most consumer/venue networks and not an error. */
  hostname: z.string().nullable(),
})
export type DeviceInfoEntry = z.infer<typeof DeviceInfoEntrySchema>

/** Keyed by deviceId, same shape as Presence/PluginHealth's own snapshot schemas. */
export const DeviceInfoSchema = z.object({
  devices: z.record(z.string(), DeviceInfoEntrySchema).default({}),
})
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>

export const DEFAULT_DEVICE_INFO: DeviceInfo = { devices: {} }

/** How long a report stays valid before this device reads as "app closed" in the ledger - same
 * reasoning as PRESENCE_TIMEOUT_MS, comfortably longer than the report interval
 * (useDeviceInfoReporter.ts). */
export const DEVICE_INFO_TIMEOUT_MS = 30_000

/** Body a tablet POSTs to report its own diagnostic info - `ip`/`lastSeenAt`/`networkReachable`/
 * `hostname` are deliberately absent: all four are determined server-side, never supplied by
 * the reporting device (`ip`/`lastSeenAt` for the same reason Presence's report excludes them;
 * `networkReachable`/`hostname` because they're the Stage-Server's own ping loop's job, not
 * something a device could truthfully self-report anyway). */
export const DeviceInfoReportSchema = z.object({
  deviceId: z.string().min(1),
  os: z.string().min(1),
  environment: z.enum(['browser', 'pwa', 'native']),
  syncStatus: z.enum(['idle', 'syncing', 'offline', 'error']),
})
export type DeviceInfoReport = z.infer<typeof DeviceInfoReportSchema>
