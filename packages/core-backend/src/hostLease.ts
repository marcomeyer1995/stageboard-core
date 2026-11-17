import { HostLeaseSchema } from 'shared-types'

export interface LeaseStatus {
  hostId: string
  epoch: number
  /** The lease has not run out on this host's own clock. */
  alive: boolean
}

export interface LeaseKeeper {
  /** Takes a message from the network: 'accepted', or 'ignored' (invalid, not from the other listed
   * host, or older than the epoch already held). */
  accept(raw: unknown): 'accepted' | 'ignored'
  /** The last accepted lease, or null if none has arrived. */
  status(): LeaseStatus | null
}

/**
 * The backup's side of the alive signal (host backup, #918, docs/25 §6e). Only a lease from the
 * *other* host the band lists counts, and only while the band lists two - a stranger on the network
 * must not hold the lease open. Expiry is counted from arrival on this host's own clock.
 */
export function createLeaseKeeper(deps: { selfHostId: string; listedHostIds: () => readonly string[]; now: () => number }): LeaseKeeper {
  let held: { hostId: string; epoch: number; expiresAt: number } | null = null
  return {
    accept(raw) {
      const parsed = HostLeaseSchema.safeParse(raw)
      if (!parsed.success) return 'ignored'
      const { hostId, epoch, leaseMs } = parsed.data
      const listed = deps.listedHostIds()
      if (listed.length < 2 || hostId === deps.selfHostId || !listed.includes(hostId)) return 'ignored'
      if (held && epoch < held.epoch) return 'ignored'
      held = { hostId, epoch, expiresAt: deps.now() + leaseMs }
      return 'accepted'
    },
    status() {
      return held ? { hostId: held.hostId, epoch: held.epoch, alive: deps.now() <= held.expiresAt } : null
    },
  }
}
