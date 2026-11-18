import { request } from 'node:http'
import { connect } from 'node:tls'

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

// The lease service itself is shared by every host (sync-host, #949); only the way it reaches the other host is this box's.
export { createHostLeaseService, TAKEOVER_AFTER_MS, INVITE_INTERVAL_MS, HANDBACK_STEADY_MS, HANDBACK_SETTLE_MS, type HostLeaseService } from 'sync-host'
