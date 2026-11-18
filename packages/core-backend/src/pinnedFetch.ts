import { request } from 'node:http'
import { Readable } from 'node:stream'
import { connect } from 'node:tls'
import { fingerprintMatches } from './hostLeaseService.js'

/**
 * A `fetch` that talks https to one other host and pins the connection to its certificate
 * fingerprint from the band's host list (host backup, #919): the check is made on the open TLS
 * connection before any request is sent, because Node does not check a self-signed certificate's
 * identity when `rejectUnauthorized` is off (see hostLeaseService.ts's requestHost). Without a
 * fingerprint it connects unpinned. Streams the body, so a long-poll changes feed works. Used as
 * PouchDB's `fetch` for the replication from the primary.
 */
export function createPinnedFetch(fingerprint: string | undefined, connectTimeoutMs = 5_000): typeof fetch {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      const signal = init?.signal ?? undefined
      if (signal?.aborted) return reject(new DOMException('The operation was aborted.', 'AbortError'))

      const socket = connect({ host: target.hostname, port: Number(target.port) || 443, servername: target.hostname, rejectUnauthorized: false, timeout: connectTimeoutMs })
      const fail = (err: Error) => {
        socket.destroy()
        reject(err)
      }
      const onAbort = () => fail(new DOMException('The operation was aborted.', 'AbortError'))
      signal?.addEventListener('abort', onAbort, { once: true })
      socket.on('error', fail)
      socket.once('timeout', () => fail(new Error('connect timeout')))
      socket.once('secureConnect', () => {
        socket.setTimeout(0) // a changes feed may stay open for a long time
        if (fingerprint !== undefined && !fingerprintMatches(socket.getPeerCertificate().fingerprint256 ?? '', fingerprint)) {
          return fail(new Error('certificate fingerprint does not match the band list'))
        }
        const headers: Record<string, string> = {}
        new Headers(init?.headers).forEach((value, key) => (headers[key] = value))
        const body = init?.body === undefined || init.body === null ? undefined : typeof init.body === 'string' ? init.body : Buffer.from(init.body as ArrayBuffer)
        if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body))
        // No `agent`: Node ignores `createConnection` with `agent: false`.
        const req = request({ host: target.hostname, port: Number(target.port) || 443, path: `${target.pathname}${target.search}`, method: init?.method ?? 'GET', headers, createConnection: () => socket }, (res) => {
          const responseHeaders = new Headers()
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) value.forEach((v) => responseHeaders.append(key, v))
            else if (value !== undefined) responseHeaders.set(key, value)
          }
          // Statuses without a body must not get one.
          const empty = res.statusCode === 204 || res.statusCode === 304
          resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), { status: res.statusCode ?? 0, statusText: res.statusMessage ?? '', headers: responseHeaders }))
        })
        req.on('error', fail)
        req.end(body)
      })
    })
}
