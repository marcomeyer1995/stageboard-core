import { ActiveWorkspaceStatusSchema, BandHostsSchema, HostTimeAnswerSchema, LEASE_LENGTH_MS, type BandHostEntry } from 'shared-types'
import { z } from 'zod'
import { createHostClock } from './hostClock.js'
import { createLeaseKeeper, type LeaseStatus } from './leaseKeeper.js'
import { leaseKey, signLease } from './leaseAuth.js'

/**
 * What a host remembers of its role (host backup, #920): the epoch it serves under and whether it is the active
 * host. A backup that took over must still be the host after a restart - and under the same epoch, or two hosts
 * would announce different ones. Where it is kept is the platform's business: a file on the laptop, the app's
 * storage on the tablet.
 */
export interface HostRole {
  epoch: number
  active: boolean
}

export interface HostRoleStore {
  load(): HostRole
  save(role: HostRole): void
}

/** What the other host answers to a lease. */
const LeaseReplySchema = z.object({ accepted: z.boolean(), epoch: z.number().int() })

export interface HostLeaseService {
  /** The primary tells the backup it is alive (call every LEASE_INTERVAL_MS). Never throws. */
  sendOnce(): Promise<void>
  /** The backup takes a lease from the network. */
  receive(raw: unknown): Promise<'accepted' | 'ignored'>
  status(): LeaseStatus | null
  /** The backup asks the primary for its time (call every 2 s, like a device). Never throws. */
  sampleOnce(): Promise<void>
  /** The primary's clock minus ours as the backup last learned it, or null. */
  clockOffsetMs(): number | null
  /** Origins (scheme, host, port) of the hosts in the band's list, as last read - for CORS (#926). */
  listedOrigins(): string[]
  /** The backup checks whether the primary is gone and takes over (call every second). 'taken' once. */
  takeoverCheck(): Promise<'taken' | 'no'>
  /** This host has taken over and is the band's host now. */
  isActive(): boolean
  /** The epoch this host announces: its configured one, or the one it took over with. */
  epoch(): number
  /** Band time: this host's clock, plus - once it has taken over - the primary's offset (docs/29). */
  bandTime(): number
  /** A primary that has seen a higher epoch than its own: it is out of date and stays quiet. */
  outdated(): boolean
  /** This host is the band's backup and has not taken over: its database is a copy, its accounts come from the primary (#919). */
  passiveBackup(): boolean
  /** This host is the band's host right now - what `/time` announces so a device can tell the host from a passive backup
   * after a handback, when both are on the same epoch (#938). A host with no host list is the host. */
  isBandHost(): boolean
  /** This host's priority in the band's list (1 primary, 2 backup), or null while the band lists fewer than two hosts or not this one. */
  priority(): 1 | 2 | null
  /** The returned primary hands the host role back (call every second): 'handed-back' once, else 'no'. #935 */
  handbackCheck(): Promise<'handed-back' | 'no'>
  /** The admin's "take over now" on the passive backup (#943): becomes host at once, also while the primary is alive.
   * Refused unless this is a passive backup that has heard its primary (it must know the epoch to rise above). */
  takeoverNow(): Promise<'taken' | 'refused'>
  /** The admin's "hand back now" on a returned primary (#943): skips the 30 s of steady answers - nothing else.
   * The copy must still be current and no song may play. 'not-needed' when this host is not out of date. */
  requestHandback(): 'requested' | 'not-needed'
}

/** Without a lease for this long, and with the primary not answering directly either, the backup takes over (docs/25 §6e: 5-8 s, with the up to 1 s check interval and the direct request of 1 s on top). Above the 1-3 s Wi-Fi hiccups. */
export const TAKEOVER_AFTER_MS = 5_000

/** How often the primary repeats the band invitation to a fresh backup - a doorbell, not a stream (#945). */
export const INVITE_INTERVAL_MS = 5_000

/** The returned primary waits until the backup has answered without a gap for this long (#935). */
export const HANDBACK_STEADY_MS = 30_000
/** ... and until its copy of the backup's data has been quiet for this long. */
export const HANDBACK_SETTLE_MS = 2_000

/**
 * Both ends of the alive signal on one host (host backup, #918, docs/25 §6e): the primary (priority
 * 1 in the band's host list) sends, the other listed host receives. Which band and its list come
 * from the band database, the key from its access code - so there is nothing to configure.
 */
export function createHostLeaseService(deps: {
  selfHostId: string
  /** The epoch this host is configured with (1 unless `STAGEBOARD_HOST_EPOCH`); a takeover raises it above that. */
  baseEpoch: number
  roleStore: HostRoleStore
  workspaceId: () => string | null
  readHosts: (workspaceId: string) => Promise<readonly BandHostEntry[] | null>
  readAccessCode: (workspaceId: string) => Promise<string | null>
  /** POSTs JSON to the other host (the lease, and the band invitation of #945); null when it did not answer. */
  post: (url: string, body: unknown, fingerprint: string | undefined) => Promise<unknown>
  get: (url: string, fingerprint: string | undefined) => Promise<unknown>
  now: () => number
  /** The returned primary's copy of the backup's data (#935). Without it no handback. */
  catchUp?: () => { state: string; lastChangeAt: number | null } | null
  /** Whether a song is playing right now (`show-state`); a throw means "cannot tell". */
  songRunning?: () => Promise<boolean>
  /** This host's own address for the other host - set together with `selfFingerprint` to teach a fresh backup its band (#945). */
  selfUrl?: string | (() => string | undefined)
  /** This host's certificate fingerprint: what the invited backup pins (#945). */
  selfFingerprint?: string | null | (() => string | null | undefined)
}): HostLeaseService {
  // Another host that cannot be reached is an answer (nothing), never an error: what the lease is about is exactly
  // the host that is gone (found on a tablet, #947: a throwing probe kept a dead primary "alive").
  const get = async (url: string, fingerprint: string | undefined): Promise<unknown> => {
    try {
      return await deps.get(url, fingerprint)
    } catch {
      return null
    }
  }
  const post = async (url: string, body: unknown, fingerprint: string | undefined): Promise<unknown> => {
    try {
      return await deps.post(url, body, fingerprint)
    } catch {
      return null
    }
  }
  let listed: string[] = []
  let keys: CryptoKey[] = []
  let accessCode: string | null = null
  /** When the primary last invited the backup - the doorbell, not every lease (#945). */
  let lastInviteAt = 0
  const keeper = createLeaseKeeper({ selfHostId: deps.selfHostId, listedHostIds: () => listed, keys: async () => keys, now: deps.now })
  let lastSentAt = 0
  const clock = createHostClock({ now: deps.now })
  let origins: string[] = []
  let role = deps.roleStore.load()
  let outdated = false
  let selfPriority: 1 | 2 | null = null
  let checking = false
  let handingBack = false
  /** The admin asked for the handback now (#943): the 30 s of steady answers no longer count. */
  let handbackAsked = false
  /** While out of date: since when the backup has answered without a gap, and the epoch it announced. */
  let steadySince: number | null = null
  let peerEpoch = 0
  const epochNow = () => Math.max(deps.baseEpoch, role.epoch)

  async function load(workspaceId: string) {
    const hosts = BandHostsSchema.safeParse(await deps.readHosts(workspaceId))
    const code = await deps.readAccessCode(workspaceId)
    listed = hosts.success ? hosts.data.map((h) => h.hostId) : []
    origins = hosts.success ? hosts.data.map((h) => new URL(h.url).origin) : []
    keys = code ? [await leaseKey(code, workspaceId)] : []
    accessCode = code ?? null
    selfPriority = hosts.success && hosts.data.length >= 2 ? (hosts.data.find((h) => h.hostId === deps.selfHostId)?.priority ?? null) : null
    return hosts.success ? hosts.data : []
  }

  return {
    async sendOnce() {
      try {
        const workspaceId = deps.workspaceId()
        if (!workspaceId) return
        const hosts = await load(workspaceId)
        const self = hosts.find((h) => h.hostId === deps.selfHostId)
        const other = hosts.find((h) => h.hostId !== deps.selfHostId)
        if (hosts.length < 2 || self?.priority !== 1 || !other || keys.length === 0) return
        const otherUrl = other.url.replace(/\/+$/, '')
        if (outdated) {
          // Quiet while the other host announces a higher epoch. Every answer counts towards the handback (#935):
          // it needs the other host to have answered steadily, not just once.
          const answer = HostTimeAnswerSchema.safeParse(await get(`${otherUrl}/time`, other.certFingerprint))
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
        const body = await signLease({ hostId: deps.selfHostId, epoch: epochNow(), leaseMs: LEASE_LENGTH_MS, sentAt: lastSentAt }, keys[0]!)
        const reply = LeaseReplySchema.safeParse(await post(`${otherUrl}/host/lease`, body, other.certFingerprint))
        // The backup took over while this host was away: its epoch is higher, this host is out of date.
        if (reply.success && reply.data.epoch > epochNow()) outdated = true
        if (outdated) return
        // A listed backup that serves no band yet is fresh: it needs the band and knows nothing of it (#945).
        // The primary teaches it here instead of the admin typing a code - the list already names it, so no
        // stranger can pick a host by asking. Once it serves a band it is left alone, whatever the band.
        const selfUrl = typeof deps.selfUrl === 'function' ? deps.selfUrl() : deps.selfUrl
        const selfFingerprint = typeof deps.selfFingerprint === 'function' ? deps.selfFingerprint() : deps.selfFingerprint
        if (selfUrl && accessCode && deps.now() - lastInviteAt >= INVITE_INTERVAL_MS) {
          lastInviteAt = deps.now()
          // An older host only knows the old path (#964): asked second when the new one gives no usable answer.
          const asked = async (path: string) => ActiveWorkspaceStatusSchema.safeParse(await get(`${otherUrl}${path}`, other.certFingerprint))
          const first = await asked('/host/active-workspace')
          const serving = first.success ? first : await asked('/server/active-workspace')
          if (serving.success && serving.data.activeWorkspaceId === null) {
            await post(
              `${otherUrl}/host/join-band-invite`,
              {
                workspaceId,
                accessCode,
                primaryUrl: selfUrl.replace(/\/+$/, ''),
                targetHostId: other.hostId,
                ...(selfFingerprint ? { fingerprint: selfFingerprint } : {}),
                sentAt: deps.now(),
              },
              other.certFingerprint,
            )
          }
        }
      } catch {
        // The backup being unreachable is exactly what the lease is about - nothing to recover here.
      }
    },
    async receive(raw) {
      const workspaceId = deps.workspaceId()
      if (!workspaceId) return 'ignored'
      try {
        await load(workspaceId)
      } catch {
        return 'ignored'
      }
      const result = await keeper.accept(raw)
      // A signed lease from the primary under a higher epoch than this host serves: the primary is back
      // and has taken the host role (#935). Step down to passive; the epoch is kept.
      const lease = keeper.status()
      if (result === 'accepted' && role.active && lease && lease.epoch > epochNow()) {
        role = { epoch: lease.epoch, active: false }
        deps.roleStore.save(role)
      }
      return result
    },
    requestHandback() {
      if (!outdated) return 'not-needed'
      handbackAsked = true
      return 'requested'
    },
    async takeoverNow() {
      if (role.active || checking) return 'refused'
      checking = true
      try {
        const workspaceId = deps.workspaceId()
        if (!workspaceId) return 'refused'
        const hosts = await load(workspaceId)
        const lease = keeper.status()
        if (hosts.length < 2 || selfPriority !== 2 || !lease) return 'refused'
        role = { epoch: Math.max(epochNow(), lease.epoch) + 1, active: true }
        deps.roleStore.save(role)
        return 'taken'
      } catch {
        return 'refused'
      } finally {
        checking = false
      }
    },
    async handbackCheck() {
      if (!outdated || handingBack || steadySince === null) return 'no'
      handingBack = true
      try {
        // The primary is healthy again only after the backup has answered for a while, not once.
        if (!handbackAsked && deps.now() - steadySince < HANDBACK_STEADY_MS) return 'no'
        // Its copy of what was written while the backup was host must be current, and quiet.
        const copy = deps.catchUp?.() ?? null
        if (!copy || copy.state !== 'caught-up' || (copy.lastChangeAt !== null && deps.now() - copy.lastChangeAt < HANDBACK_SETTLE_MS)) return 'no'
        // Never during a song. If it cannot be told, it must not guess.
        if (!deps.songRunning || (await deps.songRunning())) return 'no'
        role = { epoch: Math.max(epochNow(), peerEpoch) + 1, active: false }
        deps.roleStore.save(role)
        outdated = false
        steadySince = null
        handbackAsked = false
        return 'handed-back'
      } catch {
        return 'no'
      } finally {
        handingBack = false
      }
    },
    status: () => keeper.status(),
    clockOffsetMs: () => clock.offsetMs(),
    async sampleOnce() {
      try {
        const workspaceId = deps.workspaceId()
        if (!workspaceId) return
        const hosts = await load(workspaceId)
        const self = hosts.find((h) => h.hostId === deps.selfHostId)
        const primary = hosts.find((h) => h.priority === 1)
        if (role.active || hosts.length < 2 || self?.priority !== 2 || !primary) return
        const t0 = deps.now()
        const answer = HostTimeAnswerSchema.safeParse(await get(`${primary.url.replace(/\/+$/, '')}/time`, primary.certFingerprint))
        const t1 = deps.now()
        if (answer.success) clock.add({ t0, t1, serverTime: answer.data.serverTime })
      } catch {
        // The primary being gone is what the lease is about; the clock simply keeps its last offset.
      }
    },
    listedOrigins: () => origins,
    isActive: () => role.active,
    epoch: epochNow,
    outdated: () => outdated,
    priority: () => selfPriority,
    passiveBackup: () => selfPriority === 2 && !role.active,
    isBandHost: () => role.active || (selfPriority !== 2 && !outdated),
    bandTime: () => (role.active ? clock.bandTime() : deps.now()),
    async takeoverCheck() {
      // The direct request can take a second or more; the timer fires every second. One check at a
      // time, or each overlapping run would take over again and raise the epoch once more.
      if (role.active || checking) return 'no'
      checking = true
      try {
        const workspaceId = deps.workspaceId()
        if (!workspaceId) return 'no'
        const hosts = await load(workspaceId)
        const self = hosts.find((h) => h.hostId === deps.selfHostId)
        const primary = hosts.find((h) => h.priority === 1)
        const lease = keeper.status()
        // Only a backup that has heard its primary at least once: one started alone must not make itself host.
        if (hosts.length < 2 || self?.priority !== 2 || !primary || !lease || lease.silentForMs < TAKEOVER_AFTER_MS) return 'no'
        // Start simple (docs/25 §6e): the primary must be nowhere - a direct request fails too.
        if (HostTimeAnswerSchema.safeParse(await get(`${primary.url.replace(/\/+$/, '')}/time`, primary.certFingerprint)).success) return 'no'
        role = { epoch: Math.max(epochNow(), lease.epoch) + 1, active: true }
        deps.roleStore.save(role)
        return 'taken'
      } catch {
        return 'no'
      } finally {
        checking = false
      }
    },
  }
}
