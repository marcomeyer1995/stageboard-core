import { request } from 'node:http'
import { connect } from 'node:tls'
import { BandHostsSchema, HostTimeAnswerSchema, LEASE_LENGTH_MS, type BandHostEntry, type SignedHostLease } from 'shared-types'
import { z } from 'zod'
import { createHostClock } from './hostClock.js'
import type { HostRoleStore } from './hostRoleStore.js'
import { createLeaseKeeper, type LeaseStatus } from './hostLease.js'
import { leaseKey, signLease } from './hostLeaseAuth.js'

/** What the other host answers to a lease. */
const LeaseReplySchema = z.object({ accepted: z.boolean(), epoch: z.number().int() })

/** A certificate fingerprint (Node's `AA:BB:..`) against the band list's form (lowercase hex, no
 * separators). Nothing listed: no match. */
export function fingerprintMatches(certFingerprint256: string, listed: string | undefined): boolean {
  return listed !== undefined && certFingerprint256.replace(/:/g, '').toLowerCase() === listed
}

/**
 * One request to another host over https. The hosts' certificates are self-signed, so they are not
 * checked against a CA. With a fingerprint from the band list the connection is pinned to it - the
 * check is made here, on the open connection, before a byte is sent: Node skips `checkServerIdentity`
 * for a self-signed certificate when `rejectUnauthorized` is off, so it cannot do the pinning. With
 * no fingerprint the signature on the lease is the only protection (it holds no secret).
 * `null` when the host cannot be reached or does not match.
 */
function requestHost(method: 'GET' | 'POST', url: string, body: unknown, fingerprint: string | undefined, timeoutMs: number): Promise<{ status: number; text: string } | null> {
  return new Promise((resolve) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      resolve(null)
      return
    }
    const payload = method === 'POST' ? JSON.stringify(body) : ''
    const socket = connect({ host: target.hostname, port: Number(target.port) || 443, servername: target.hostname, rejectUnauthorized: false, timeout: timeoutMs })
    const fail = () => {
      socket.destroy()
      resolve(null)
    }
    socket.on('error', fail)
    socket.on('timeout', fail)
    socket.on('secureConnect', () => {
      if (fingerprint !== undefined && !fingerprintMatches(socket.getPeerCertificate().fingerprint256 ?? '', fingerprint)) return fail()
      // No `agent`: with `agent: false` Node ignores `createConnection` and opens an unchecked second connection.
      const req = request(
        {
          host: target.hostname,
          port: Number(target.port) || 443,
          path: `${target.pathname}${target.search}`,
          method,
          headers: method === 'POST' ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
          createConnection: () => socket,
          timeout: timeoutMs,
        },
        (res) => {
          let text = ''
          res.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')))
          res.on('end', () => {
            socket.destroy()
            resolve({ status: res.statusCode ?? 0, text })
          })
        },
      )
      req.on('error', fail)
      req.on('timeout', fail)
      req.end(payload)
    })
  })
}

/** POSTs JSON to another host. True on a 2xx. */
export async function postToHost(url: string, body: unknown, fingerprint: string | undefined, timeoutMs = 2_000): Promise<boolean> {
  const response = await requestHost('POST', url, body, fingerprint, timeoutMs)
  return response !== null && response.status >= 200 && response.status < 300
}

/** POSTs JSON and returns the JSON answer; null on any failure, a non-2xx, or an answer that is not JSON. */
export async function postJsonToHost(url: string, body: unknown, fingerprint: string | undefined, timeoutMs = 2_000): Promise<unknown> {
  const response = await requestHost('POST', url, body, fingerprint, timeoutMs)
  if (response === null || response.status < 200 || response.status >= 300) return null
  try {
    return JSON.parse(response.text)
  } catch {
    return null
  }
}

/** GETs JSON from another host; null on any failure or an answer that is not JSON. */
export async function getFromHost(url: string, fingerprint: string | undefined, timeoutMs = 2_000): Promise<unknown> {
  const response = await requestHost('GET', url, undefined, fingerprint, timeoutMs)
  if (response === null || response.status < 200 || response.status >= 300) return null
  try {
    return JSON.parse(response.text)
  } catch {
    return null
  }
}

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
  /** The returned primary hands the host role back (call every second): 'handed-back' once, else 'no'. #935 */
  handbackCheck(): Promise<'handed-back' | 'no'>
}

/** Without a lease for this long, and with the primary not answering directly either, the backup takes over (docs/25 §6e: 5-8 s, with the up to 1 s check interval and the direct request of 1 s on top). Above the 1-3 s Wi-Fi hiccups. */
export const TAKEOVER_AFTER_MS = 5_000

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
  /** POSTs the lease; the answer is the other host's `{ accepted, epoch }`, null when it did not answer. */
  post: (url: string, body: SignedHostLease, fingerprint: string | undefined) => Promise<unknown>
  get: (url: string, fingerprint: string | undefined) => Promise<unknown>
  now: () => number
  /** The returned primary's copy of the backup's data (#935). Without it no handback. */
  catchUp?: () => { state: string; lastChangeAt: number | null } | null
  /** Whether a song is playing right now (`show-state`); a throw means "cannot tell". */
  songRunning?: () => Promise<boolean>
}): HostLeaseService {
  let listed: string[] = []
  let keys: Buffer[] = []
  const keeper = createLeaseKeeper({ selfHostId: deps.selfHostId, listedHostIds: () => listed, keys: () => keys, now: deps.now })
  let lastSentAt = 0
  const clock = createHostClock({ now: deps.now })
  let origins: string[] = []
  let role = deps.roleStore.load()
  let outdated = false
  let selfPriority: 1 | 2 | null = null
  let checking = false
  let handingBack = false
  /** While out of date: since when the backup has answered without a gap, and the epoch it announced. */
  let steadySince: number | null = null
  let peerEpoch = 0
  const epochNow = () => Math.max(deps.baseEpoch, role.epoch)

  async function load(workspaceId: string) {
    const hosts = BandHostsSchema.safeParse(await deps.readHosts(workspaceId))
    const code = await deps.readAccessCode(workspaceId)
    listed = hosts.success ? hosts.data.map((h) => h.hostId) : []
    origins = hosts.success ? hosts.data.map((h) => new URL(h.url).origin) : []
    keys = code ? [leaseKey(code, workspaceId)] : []
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
          const answer = HostTimeAnswerSchema.safeParse(await deps.get(`${otherUrl}/time`, other.certFingerprint))
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
        const body = signLease({ hostId: deps.selfHostId, epoch: epochNow(), leaseMs: LEASE_LENGTH_MS, sentAt: lastSentAt }, keys[0]!)
        const reply = LeaseReplySchema.safeParse(await deps.post(`${otherUrl}/host/lease`, body, other.certFingerprint))
        // The backup took over while this host was away: its epoch is higher, this host is out of date.
        if (reply.success && reply.data.epoch > epochNow()) outdated = true
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
      const result = keeper.accept(raw)
      // A signed lease from the primary under a higher epoch than this host serves: the primary is back
      // and has taken the host role (#935). Step down to passive; the epoch is kept.
      const lease = keeper.status()
      if (result === 'accepted' && role.active && lease && lease.epoch > epochNow()) {
        role = { epoch: lease.epoch, active: false }
        deps.roleStore.save(role)
      }
      return result
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
        deps.roleStore.save(role)
        outdated = false
        steadySince = null
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
        const answer = HostTimeAnswerSchema.safeParse(await deps.get(`${primary.url.replace(/\/+$/, '')}/time`, primary.certFingerprint))
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
    passiveBackup: () => selfPriority === 2 && !role.active,
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
        if (HostTimeAnswerSchema.safeParse(await deps.get(`${primary.url.replace(/\/+$/, '')}/time`, primary.certFingerprint)).success) return 'no'
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
