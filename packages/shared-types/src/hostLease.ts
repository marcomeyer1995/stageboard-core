import { z } from 'zod'

/**
 * The primary's alive signal to the backup (host backup, #918, docs/25 §6e): "I am the host for
 * the next `leaseMs`". A duration, not a point in time - the backup counts it from when the
 * message arrived on its own clock, so no clock offset between the hosts can skew it.
 */
export const HostLeaseSchema = z.object({
  hostId: z.string().min(1),
  epoch: z.number().int().min(1),
  leaseMs: z.number().positive(),
  /** The primary's own clock, ms. Only ever compared with the same host's earlier ones: the backup
   * refuses a lease whose `sentAt` does not rise, so a recorded one cannot be replayed. */
  sentAt: z.number().int().nonnegative(),
})
export type HostLease = z.infer<typeof HostLeaseSchema>

/** Sent every second (docs/25 §6e). */
export const LEASE_INTERVAL_MS = 1_000
/** Outlasts a Wi-Fi hiccup of 1-3 s (docs/09, docs/11) but stays under the 5-8 s after which the
 * backup may take over - that decision is its own step (#920). */
export const LEASE_LENGTH_MS = 4_000

/** What goes over the wire: the lease and its HMAC (hex), keyed from the band code (core-backend/hostLeaseAuth.ts). */
export const SignedHostLeaseSchema = z.object({ lease: HostLeaseSchema, sig: z.string().regex(/^[0-9a-f]{64}$/) })
export type SignedHostLease = z.infer<typeof SignedHostLeaseSchema>
