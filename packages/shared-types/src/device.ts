import { z } from 'zod'

/**
 * A registered tablet/server in this workspace - #10's DeviceRegistry, first slice: just
 * enough to show a real name instead of "Dieses Gerät"/"Anderes Gerät" wherever a device is
 * already referenced (Master-Token's `masterHolderId`, ShowState's `deviceClaims`).
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
})
export type Device = z.infer<typeof DeviceSchema>
