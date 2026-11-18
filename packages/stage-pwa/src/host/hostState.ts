import { HostTimeAnswerSchema, type BandHostEntry } from 'shared-types'
import { createLeaseKeeper, type LeaseStatus } from './leaseKeeper'

/** The role this host serves under: what `/time` announces. The epoch only ever rises. */
export interface HostRole {
  epoch: number
  active: boolean
}

export interface HostState {
  hostId: string
  epoch: number
  active: boolean
  /** The priority the band's list gives this host, or null while it is not listed (or listed alone). */
  priority: 1 | 2 | null
}

/** Without a lease for this long, and with the primary not answering directly either, the backup
 * takes over (docs/25 §6e: 5-8 s, with the up to 1 s check interval and the direct request of 1 s
 * on top). Above the 1-3 s Wi-Fi hiccups. */
export const TAKEOVER_AFTER_MS = 5_000

export interface HostStateMachine {
  /** A lease from the network: accepted only from the other listed host and only with a valid signature. */
  acceptLease(raw: unknown): Promise<'accepted' | 'ignored'>
  /** The backup checks whether the primary is gone and takes over (call every second). 'taken' once. */
  takeoverCheck(): Promise<'taken' | 'no'>
  /** The admin's "take over now": becomes host at once, also while the primary is alive. */
  takeoverNow(): Promise<'taken' | 'refused'>
  state(): HostState
  lease(): LeaseStatus | null
}

/**
 * The tablet's lease/takeover state machine (host backup, #947, docs/25 §6e): the same rules as
 * core-backend's `createHostLeaseService` (#918/#920), in the app and for now deliberately a second
 * implementation - folding both into one host module is #932. Only a **listed backup** that has
 * heard its primary at least once may take over; a host started alone never makes itself host.
 */
export function createHostStateMachine(deps: {
  selfHostId: string
  /** The epoch this tablet starts with (1, or the one it had when the switch was turned off). */
  baseEpoch: number
  loadRole: () => HostRole | null
  saveRole: (role: HostRole) => void
  /** The band's host list as the app last read it. */
  hosts: () => readonly BandHostEntry[] | undefined
  /** Every lease key that may be valid: the band's code can change mid-gig. */
  keys: () => Promise<readonly CryptoKey[]>
  /** GET the primary's `/time` over a pinned connection - resolves with its answer or throws/null. */
  probePrimary: (url: string, fingerprint: string | undefined) => Promise<unknown>
  now: () => number
  takeoverAfterMs?: number
}): HostStateMachine {
  let role = deps.loadRole() ?? { epoch: Math.max(1, deps.baseEpoch), active: false }
  let checking = false
  const epochNow = () => Math.max(deps.baseEpoch, role.epoch)
  const keeper = createLeaseKeeper({
    selfHostId: deps.selfHostId,
    listedHostIds: () => (deps.hosts() ?? []).map((h) => h.hostId),
    keys: deps.keys,
    now: deps.now,
  })
  const primaryOf = () => (deps.hosts() ?? []).find((h) => h.priority === 1) ?? null
  const selfOf = () => (deps.hosts() ?? []).find((h) => h.hostId === deps.selfHostId) ?? null

  return {
    async acceptLease(raw) {
      const result = await keeper.accept(raw)
      // A signed lease from the primary under a higher epoch than this host serves: the primary is
      // back and has taken the host role (#935). Step down to passive; the epoch is kept.
      const lease = keeper.status()
      if (result === 'accepted' && role.active && lease && lease.epoch > epochNow()) {
        role = { epoch: lease.epoch, active: false }
        deps.saveRole(role)
      }
      return result
    },
    async takeoverCheck() {
      // The direct request can take a second or more; the timer fires every second. One check at a
      // time, or each overlapping run would take over again and raise the epoch once more.
      if (role.active || checking) return 'no'
      checking = true
      try {
        const hosts = deps.hosts() ?? []
        const self = selfOf()
        const primary = primaryOf()
        const lease = keeper.status()
        if (hosts.length < 2 || self?.priority !== 2 || !primary || !lease || lease.silentForMs < (deps.takeoverAfterMs ?? TAKEOVER_AFTER_MS)) return 'no'
        // Start simple (docs/25 §6e): the primary must be nowhere - a direct request fails too.
        // A request that fails (throws) is the same as no answer - that is exactly the case this is for.
        const answer = await deps.probePrimary(primary.url.replace(/\/+$/, ''), primary.certFingerprint).catch(() => null)
        if (HostTimeAnswerSchema.safeParse(answer).success) return 'no'
        role = { epoch: Math.max(epochNow(), lease.epoch) + 1, active: true }
        deps.saveRole(role)
        return 'taken'
      } catch {
        return 'no'
      } finally {
        checking = false
      }
    },
    async takeoverNow() {
      if (role.active || checking) return 'refused'
      checking = true
      try {
        const hosts = deps.hosts() ?? []
        const lease = keeper.status()
        if (hosts.length < 2 || selfOf()?.priority !== 2 || !lease) return 'refused'
        role = { epoch: Math.max(epochNow(), lease.epoch) + 1, active: true }
        deps.saveRole(role)
        return 'taken'
      } catch {
        return 'refused'
      } finally {
        checking = false
      }
    },
    state() {
      const hosts = deps.hosts() ?? []
      return {
        hostId: deps.selfHostId,
        epoch: epochNow(),
        active: role.active,
        priority: hosts.length >= 2 ? (selfOf()?.priority ?? null) : null,
      }
    },
    lease: () => keeper.status(),
  }
}
