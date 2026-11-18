import { verifyLease } from './leaseAuth'

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
  accept(raw: unknown): Promise<'accepted' | 'ignored'>
  /** The last accepted lease, or null if none has arrived. */
  status(): LeaseStatus | null
}

/**
 * The backup's side of the alive signal in the app (host backup, #947): the port of
 * core-backend's `createLeaseKeeper` (#918) to WebCrypto. Only a lease signed with the band's key
 * from the *other* listed host counts, and only while the band lists two. Expiry is counted from
 * arrival on this device's own clock. `keys`: every key that may be valid - the band code can
 * change mid-gig, and the new one may not have arrived yet.
 */
export function createLeaseKeeper(deps: {
  selfHostId: string
  listedHostIds: () => readonly string[]
  keys: () => Promise<readonly CryptoKey[]>
  now: () => number
}): LeaseKeeper {
  let held: { hostId: string; epoch: number; sentAt: number; expiresAt: number; arrivedAt: number } | null = null
  return {
    async accept(raw) {
      const listed = deps.listedHostIds()
      if (listed.length < 2) return 'ignored'
      let lease = null
      for (const key of await deps.keys()) {
        lease = await verifyLease(raw, key)
        if (lease) break
      }
      if (!lease || lease.hostId === deps.selfHostId || !listed.includes(lease.hostId)) return 'ignored'
      if (held && lease.epoch < held.epoch) return 'ignored'
      if (held && lease.hostId === held.hostId && lease.epoch === held.epoch && lease.sentAt <= held.sentAt) return 'ignored'
      const now = deps.now()
      held = { hostId: lease.hostId, epoch: lease.epoch, sentAt: lease.sentAt, expiresAt: now + lease.leaseMs, arrivedAt: now }
      return 'accepted'
    },
    status() {
      return held ? { hostId: held.hostId, epoch: held.epoch, alive: deps.now() <= held.expiresAt, silentForMs: deps.now() - held.arrivedAt } : null
    },
  }
}
