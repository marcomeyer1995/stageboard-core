import { verifyLease } from './hostLeaseAuth.js'

export interface LeaseStatus {
  hostId: string
  epoch: number
  /** The lease has not run out on this host's own clock. */
  alive: boolean
  /** How long ago the last lease arrived, ms on this host's own clock. */
  silentForMs: number
}

export interface LeaseKeeper {
  /** Takes a message from the network: 'accepted', or 'ignored' (unsigned or wrongly signed, not
   * from the other listed host, replayed, or older than the epoch already held). */
  accept(raw: unknown): 'accepted' | 'ignored'
  /** The last accepted lease, or null if none has arrived. */
  status(): LeaseStatus | null
}

/**
 * The backup's side of the alive signal (host backup, #918, docs/25 §6e). Only a lease signed with
 * the band's key (hostLeaseAuth.ts) from the *other* listed host counts, and only while the band
 * lists two. Expiry is counted from arrival on this host's own clock. `keys`: every key that may be
 * valid - the band code can change mid-gig, and the database may not have replicated yet.
 */
export function createLeaseKeeper(deps: {
  selfHostId: string
  listedHostIds: () => readonly string[]
  keys: () => readonly Buffer[]
  now: () => number
}): LeaseKeeper {
  let held: { hostId: string; epoch: number; sentAt: number; expiresAt: number; arrivedAt: number } | null = null
  return {
    accept(raw) {
      const listed = deps.listedHostIds()
      if (listed.length < 2) return 'ignored'
      let lease = null
      for (const key of deps.keys()) {
        lease = verifyLease(raw, key)
        if (lease) break
      }
      if (!lease || lease.hostId === deps.selfHostId || !listed.includes(lease.hostId)) return 'ignored'
      if (held && lease.epoch < held.epoch) return 'ignored'
      if (held && lease.hostId === held.hostId && lease.epoch === held.epoch && lease.sentAt <= held.sentAt) return 'ignored'
      held = { hostId: lease.hostId, epoch: lease.epoch, sentAt: lease.sentAt, expiresAt: deps.now() + lease.leaseMs, arrivedAt: deps.now() }
      return 'accepted'
    },
    status() {
      return held ? { hostId: held.hostId, epoch: held.epoch, alive: deps.now() <= held.expiresAt, silentForMs: deps.now() - held.arrivedAt } : null
    },
  }
}
