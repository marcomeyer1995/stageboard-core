import { request } from 'node:http'
import { connect } from 'node:tls'
import { BandHostsSchema, HostTimeAnswerSchema, LEASE_LENGTH_MS, type BandHostEntry, type SignedHostLease } from 'shared-types'
import { createHostClock } from './hostClock.js'
import { createLeaseKeeper, type LeaseStatus } from './hostLease.js'
import { leaseKey, signLease } from './hostLeaseAuth.js'

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
  get: (url: string, fingerprint: string | undefined) => Promise<unknown>
  now: () => number
}): HostLeaseService {
  let listed: string[] = []
  let keys: Buffer[] = []
  const keeper = createLeaseKeeper({ selfHostId: deps.selfHostId, listedHostIds: () => listed, keys: () => keys, now: deps.now })
  let lastSentAt = 0
  const clock = createHostClock({ now: deps.now })

  async function load(workspaceId: string) {
    const hosts = BandHostsSchema.safeParse(await deps.readHosts(workspaceId))
    const code = await deps.readAccessCode(workspaceId)
    listed = hosts.success ? hosts.data.map((h) => h.hostId) : []
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
      await load(workspaceId)
      return keeper.accept(raw)
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
        if (hosts.length < 2 || self?.priority !== 2 || !primary) return
        const t0 = deps.now()
        const answer = HostTimeAnswerSchema.safeParse(await deps.get(`${primary.url.replace(/\/+$/, '')}/time`, primary.certFingerprint))
        const t1 = deps.now()
        if (answer.success) clock.add({ t0, t1, serverTime: answer.data.serverTime })
      } catch {
        // The primary being gone is what the lease is about; the clock simply keeps its last offset.
      }
    },
  }
}
