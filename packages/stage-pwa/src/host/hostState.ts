import { ActiveWorkspaceStatusSchema, HostTimeAnswerSchema, LEASE_LENGTH_MS, type BandHostEntry } from 'shared-types'
import { z } from 'zod'
import { createLeaseKeeper, type LeaseStatus } from './leaseKeeper'
import { signLease } from './leaseAuth'

/** The role this host serves under: what `/time` announces. The epoch only ever rises. */
export interface HostRole {
  epoch: number
  active: boolean
}

export interface HostState {
  hostId: string
  epoch: number
  /** This host is the band's host right now and serves it: the primary while it is current, the backup after a takeover. */
  active: boolean
  /** A primary that has seen a higher epoch than its own: it is out of date, stays quiet and copies the backup's data. */
  outdated: boolean
  /** The priority the band's list gives this host, or null while it is not listed (or listed alone). */
  priority: 1 | 2 | null
}

/** Without a lease for this long, and with the primary not answering directly either, the backup
 * takes over (docs/25 §6e: 5-8 s, with the up to 1 s check interval and the direct request of 1 s
 * on top). Above the 1-3 s Wi-Fi hiccups. */
export const TAKEOVER_AFTER_MS = 5_000
/** How often the primary repeats the band invitation to a fresh backup - a doorbell, not a stream (#945). */
export const INVITE_INTERVAL_MS = 5_000
/** The returned primary waits until the backup has answered without a gap for this long (#935). */
export const HANDBACK_STEADY_MS = 30_000
/** ... and until its copy of the backup's data has been quiet for this long. */
export const HANDBACK_SETTLE_MS = 2_000

/** What the other host answers to a lease. */
const LeaseReplySchema = z.object({ accepted: z.boolean(), epoch: z.number().int() })

export interface HostStateMachine {
  /** A lease from the network: accepted only from the other listed host and only with a valid signature. */
  acceptLease(raw: unknown): Promise<'accepted' | 'ignored'>
  /** The backup checks whether the primary is gone and takes over (call every second). 'taken' once. */
  takeoverCheck(): Promise<'taken' | 'no'>
  /** The admin's "take over now": becomes host at once, also while the primary is alive. */
  takeoverNow(): Promise<'taken' | 'refused'>
  /** The primary tells the backup it is alive (call every second); out of date it only watches the backup. Never throws. */
  sendOnce(): Promise<void>
  /** The returned primary takes the host role back (call every second): 'handed-back' once, else 'no'. */
  handbackCheck(): Promise<'handed-back' | 'no'>
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
  /** The band this tablet serves (the invite names it). */
  workspaceId: string
  /** The epoch this tablet starts with (1, or the one it had when the switch was turned off). */
  baseEpoch: number
  loadRole: () => HostRole | null
  saveRole: (role: HostRole) => void
  /** The band's host list as the app last read it. */
  hosts: () => readonly BandHostEntry[] | undefined
  /** Every lease key that may be valid: the band's code can change mid-gig. */
  keys: () => Promise<readonly CryptoKey[]>
  /** GET JSON from the other host over a pinned connection - its answer, or null/throws when it does not answer. */
  get: (url: string, fingerprint: string | undefined) => Promise<unknown>
  /** POST JSON to the other host (the lease, the band invite) - its answer, or null. Absent: this host sends nothing. */
  post?: (url: string, body: unknown, fingerprint: string | undefined) => Promise<unknown>
  /** This host's own address and certificate fingerprint, for the invite (#945); null while the server is not up. */
  self?: () => { url: string; fingerprint: string } | null
  /** The band's code, to invite a fresh backup with. */
  accessCode?: () => Promise<string | null>
  /** The returned primary's copy of the backup's data (#935). Without it no handback. */
  catchUp?: () => { state: string; lastChangeAt: number | null } | null
  /** Whether a song is playing right now; a throw means "cannot tell". Without it no handback. */
  songRunning?: () => Promise<boolean>
  now: () => number
  takeoverAfterMs?: number
}): HostStateMachine {
  let role = deps.loadRole() ?? { epoch: Math.max(1, deps.baseEpoch), active: false }
  let checking = false
  let outdated = false
  let handingBack = false
  let sending = false
  let lastSentAt = 0
  let lastInviteAt = 0
  /** While out of date: since when the backup has answered without a gap, and the epoch it announced. */
  let steadySince: number | null = null
  let peerEpoch = 0
  const epochNow = () => Math.max(deps.baseEpoch, role.epoch)
  const keeper = createLeaseKeeper({
    selfHostId: deps.selfHostId,
    listedHostIds: () => (deps.hosts() ?? []).map((h) => h.hostId),
    keys: deps.keys,
    now: deps.now,
  })
  const primaryOf = () => (deps.hosts() ?? []).find((h) => h.priority === 1) ?? null
  const otherOf = () => (deps.hosts() ?? []).find((h) => h.hostId !== deps.selfHostId) ?? null
  const hostsReady = () => (deps.hosts() ?? []).length >= 2
  const priorityNow = () => (hostsReady() ? (selfOf()?.priority ?? null) : null)
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
        const answer = await deps.get(`${primary.url.replace(/\/+$/, '')}/time`, primary.certFingerprint).catch(() => null)
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
    async sendOnce() {
      if (sending || !deps.post) return
      sending = true
      try {
        const self = selfOf()
        const other = otherOf()
        const key = (await deps.keys())[0]
        if (!hostsReady() || self?.priority !== 1 || !other || !key) return
        const otherUrl = other.url.replace(/\/+$/, '')
        if (outdated) {
          // Quiet while the other host announces a higher epoch. Every answer counts towards the handback (#935):
          // it needs the other host to have answered steadily, not just once.
          const answer = HostTimeAnswerSchema.safeParse(await deps.get(`${otherUrl}/time`, other.certFingerprint).catch(() => null))
          if (!answer.success) {
            steadySince = null
            return
          }
          steadySince ??= deps.now()
          peerEpoch = answer.data.epoch ?? 0
          if (peerEpoch <= epochNow()) outdated = false
          return
        }
        // Strictly rising even when two sends fall in the same millisecond.
        lastSentAt = Math.max(deps.now(), lastSentAt + 1)
        const lease = await signLease({ hostId: deps.selfHostId, epoch: epochNow(), leaseMs: LEASE_LENGTH_MS, sentAt: lastSentAt }, key)
        const reply = LeaseReplySchema.safeParse(await deps.post(`${otherUrl}/host/lease`, lease, other.certFingerprint).catch(() => null))
        // The backup took over while this host was away: its epoch is higher, this host is out of date.
        if (reply.success && reply.data.epoch > epochNow()) {
          outdated = true
          return
        }
        // A listed backup that serves no band yet is fresh: it needs the band and knows nothing of it (#945).
        const me = deps.self?.() ?? null
        const code = await deps.accessCode?.()
        if (me && code && deps.now() - lastInviteAt >= INVITE_INTERVAL_MS) {
          lastInviteAt = deps.now()
          const serving = ActiveWorkspaceStatusSchema.safeParse(await deps.get(`${otherUrl}/server/active-workspace`, other.certFingerprint).catch(() => null))
          if (serving.success && serving.data.activeWorkspaceId === null) {
            await deps.post(`${otherUrl}/host/join-band-invite`, { workspaceId: deps.workspaceId, accessCode: code, primaryUrl: me.url.replace(/\/+$/, ''), targetHostId: other.hostId, fingerprint: me.fingerprint, sentAt: deps.now() }, other.certFingerprint).catch(() => null)
          }
        }
      } catch {
        // The backup being unreachable is exactly what the lease is about - nothing to recover here.
      } finally {
        sending = false
      }
    },
    async handbackCheck() {
      if (!outdated || handingBack || steadySince === null) return 'no'
      handingBack = true
      try {
        // The primary is healthy again only after the backup has answered for a while, not once.
        if (deps.now() - steadySince < HANDBACK_STEADY_MS) return 'no'
        // Its copy of what was written while the backup was host must be current, and quiet.
        const copy = deps.catchUp?.() ?? null
        if (!copy || copy.state !== 'caught-up' || (copy.lastChangeAt !== null && deps.now() - copy.lastChangeAt < HANDBACK_SETTLE_MS)) return 'no'
        // Never during a song. If it cannot be told, it must not guess.
        if (!deps.songRunning || (await deps.songRunning())) return 'no'
        role = { epoch: Math.max(epochNow(), peerEpoch) + 1, active: false }
        deps.saveRole(role)
        outdated = false
        steadySince = null
        return 'handed-back'
      } catch {
        return 'no'
      } finally {
        handingBack = false
      }
    },
    state() {
      const priority = priorityNow()
      return {
        hostId: deps.selfHostId,
        epoch: epochNow(),
        active: role.active || (priority === 1 && !outdated),
        outdated,
        priority,
      }
    },
    lease: () => keeper.status(),
  }
}
