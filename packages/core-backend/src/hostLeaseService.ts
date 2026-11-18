import { request } from 'node:http'
import { connect } from 'node:tls'
import { BandHostsSchema, LEASE_LENGTH_MS, type BandHostEntry, type SignedHostLease } from 'shared-types'
import { createLeaseKeeper, type LeaseStatus } from './hostLease.js'
import { leaseKey, signLease } from './hostLeaseAuth.js'

/** A certificate fingerprint (Node's `AA:BB:..`) against the band list's form (lowercase hex, no
 * separators). Nothing listed: no match. */
export function fingerprintMatches(certFingerprint256: string, listed: string | undefined): boolean {
  return listed !== undefined && certFingerprint256.replace(/:/g, '').toLowerCase() === listed
}

/**
 * POSTs to another host over https. The hosts' certificates are self-signed, so they are not
 * checked against a CA. With a fingerprint from the band list the connection is pinned to it - the
 * check is made here, on the open connection, before a byte is sent: Node skips `checkServerIdentity`
 * for a self-signed certificate when `rejectUnauthorized` is off, so it cannot do the pinning. With
 * no fingerprint the signature on the lease is the only protection (it holds no secret). True on a 2xx.
 */
export function postToHost(url: string, body: unknown, fingerprint: string | undefined, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    let target: URL
    try {
      target = new URL(url)
    } catch {
      resolve(false)
      return
    }
    const payload = JSON.stringify(body)
    const socket = connect({ host: target.hostname, port: Number(target.port) || 443, servername: target.hostname, rejectUnauthorized: false, timeout: timeoutMs })
    const fail = () => {
      socket.destroy()
      resolve(false)
    }
    socket.on('error', fail)
    socket.on('timeout', fail)
    socket.on('secureConnect', () => {
      if (fingerprint !== undefined && !fingerprintMatches(socket.getPeerCertificate().fingerprint256 ?? '', fingerprint)) return fail()
      const req = request(
        { host: target.hostname, port: Number(target.port) || 443, path: `${target.pathname}${target.search}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, createConnection: () => socket, timeout: timeoutMs },
        (res) => {
          res.resume()
          socket.destroy()
          resolve((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300)
        },
      )
      req.on('error', fail)
      req.on('timeout', fail)
      req.end(payload)
    })
  })
}

export interface HostLeaseService {
  /** The primary tells the backup it is alive (call every LEASE_INTERVAL_MS). Never throws. */
  sendOnce(): Promise<void>
  /** The backup takes a lease from the network. */
  receive(raw: unknown): Promise<'accepted' | 'ignored'>
  status(): LeaseStatus | null
  /** Origins (scheme, host, port) of the hosts in the band's list, as last read - for CORS (#926). */
  listedOrigins(): string[]
}

/**
 * Both ends of the alive signal on one host (host backup, #918, docs/25 §6e): the primary (priority
 * 1 in the band's host list) sends, the other listed host receives. Which band and its list come
 * from the band database, the key from its access code - so there is nothing to configure.
 */
export function createHostLeaseService(deps: {
  selfHostId: string
  epoch: () => number
  workspaceId: () => string | null
  readHosts: (workspaceId: string) => Promise<readonly BandHostEntry[] | null>
  readAccessCode: (workspaceId: string) => Promise<string | null>
  post: (url: string, body: SignedHostLease, fingerprint: string | undefined) => Promise<boolean>
  now: () => number
}): HostLeaseService {
  let listed: string[] = []
  let keys: Buffer[] = []
  const keeper = createLeaseKeeper({ selfHostId: deps.selfHostId, listedHostIds: () => listed, keys: () => keys, now: deps.now })
  let lastSentAt = 0
  let origins: string[] = []

  async function load(workspaceId: string) {
    const hosts = BandHostsSchema.safeParse(await deps.readHosts(workspaceId))
    const code = await deps.readAccessCode(workspaceId)
    listed = hosts.success ? hosts.data.map((h) => h.hostId) : []
    origins = hosts.success ? hosts.data.map((h) => new URL(h.url).origin) : []
    keys = code ? [leaseKey(code, workspaceId)] : []
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
        // Strictly rising even when two sends fall in the same millisecond.
        lastSentAt = Math.max(deps.now(), lastSentAt + 1)
        const body = signLease({ hostId: deps.selfHostId, epoch: deps.epoch(), leaseMs: LEASE_LENGTH_MS, sentAt: lastSentAt }, keys[0]!)
        await deps.post(`${other.url.replace(/\/+$/, '')}/host/lease`, body, other.certFingerprint)
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
      return keeper.accept(raw)
    },
    status: () => keeper.status(),
    listedOrigins: () => origins,
  }
}
