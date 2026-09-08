import { z } from 'zod'
import { AdminProofSchema } from './workspace.js'

/**
 * A registered tablet/server in this workspace - #10's DeviceRegistry, first slice: just
 * enough to show a real name instead of "Dieses Gerät"/"Anderes Gerät" wherever a device is
 * already referenced (Master-Token's `masterHolderId`, a HardwareBinding's `executionTarget` -
 * hardwareSetup.ts).
 *
 * `id` is the same stable per-device random id used everywhere else a device is referenced -
 * see stage-pwa's `deviceId.ts` (unified 2026-09-04 with what Presence already used, so
 * "which device holds X" and "which device is online" always mean the same device).
 */
export const DeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Last time this device confirmed its own registry entry - a coarse "roughly how recently
   * was this device around" signal, not a real-time online/offline indicator (Presence -
   * presence.ts - already covers that, far more frequently, without touching synced storage;
   * a heartbeat has no offline/multi-master value, so it doesn't belong in a synced doc). */
  lastSeenAt: z.number().int().nonnegative(),
  /** Stamped once, the first time this device is ever seen in this workspace - never
   * overwritten afterward (see useDevicesStore.ts's `init()`). The actual "ever joined, since
   * when" fact the Device Ledger (DeviceLedgerView.tsx) is named for - `lastSeenAt` above only
   * ever answers "how recently," not "since when." */
  firstSeenAt: z.number().int().nonnegative(),
  /** An admin's decision to kick this device out (Device Ledger, Marco's explicit request) -
   * a *soft*, cooperative kick: this device's own app watches its own entry and locks itself
   * out (App.tsx's revocation guard) rather than the Stage-Server enforcing it at the auth
   * layer. Deliberately on this synced doc, not an ephemeral store (deviceInfo.ts) - unlike
   * IP/OS/sync-status, this must be durable and reach a currently-offline device the moment it
   * reconnects, the same reason `lastSeenAt`'s doc comment gives for keeping presence-like data
   * OFF this doc: here that reasoning runs the other way. */
  revoked: z.boolean().default(false),
})
export type Device = z.infer<typeof DeviceSchema>

/** Body an admin POSTs to `/workspaces/:workspaceId/devices/:deviceId/revoke` - same
 * `AdminProofSchema` every other admin-gated endpoint in this codebase requires (see
 * `SetMemberAdminRequestSchema` in workspace.ts for the sibling pattern this mirrors). */
export const RevokeDeviceRequestSchema = AdminProofSchema.extend({
  revoked: z.boolean(),
})
export type RevokeDeviceRequest = z.infer<typeof RevokeDeviceRequestSchema>
