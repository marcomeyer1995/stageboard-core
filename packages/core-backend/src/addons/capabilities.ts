import { createSocket } from 'node:dgram'
import { z } from 'zod'
import type { AddonError } from 'shared-types'
import type { helperRunnerFor } from './helpers.js'

/**
 * What an add-on may ask the world for (docs/36 §5, #964). The add-on holds no network handle, no socket and starts no program: it **asks**, with a
 * `request` for a capability, and this decides - against the `permissions` the band confirmed - and does it. A denied request sends nothing.
 */
export type CapabilityResult = { ok: true; body: unknown } | { ok: false; error: AddonError }
export type Capabilities = (method: string, body: unknown) => Promise<CapabilityResult>

const MAX_HTTP_BODY = 8 * 1024 * 1024
const MAX_REDIRECTS = 5

const fail = (code: string, message: string, params?: AddonError['params']): CapabilityResult => ({ ok: false, error: { code, message, ...(params ? { params } : {}) } })
const denied = (capability: string, target: string): CapabilityResult => fail('permission.denied', `The add-on has no permission for ${capability} ${target}`, { capability, origin: target })

const HttpRequest = z.object({ url: z.string(), method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(), headers: z.record(z.string(), z.string()).optional(), body: z.string().optional() })
const UdpRequest = z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535), bytes: z.instanceof(Uint8Array).refine((b) => b.length <= 8192, 'at most 8192 bytes') })
const HelperRequest = z.object({ helper: z.string().min(1), args: z.array(z.string()), files: z.array(z.object({ name: z.string(), bytes: z.instanceof(Uint8Array) })).default([]) })

/** The origin of `url` when it is a plain http(s) URL without credentials; otherwise null - `user@host` is how an allowed-looking URL points elsewhere. */
function originOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) return null
    return parsed.origin
  } catch {
    return null
  }
}

export function createCapabilities(options: {
  permissions: readonly string[]
  helpers: ReturnType<typeof helperRunnerFor>
  fetchImpl?: typeof fetch
}): Capabilities {
  const doFetch = options.fetchImpl ?? fetch
  const allowedOrigins = new Set(options.permissions.filter((p) => p.startsWith('http:')).map((p) => p.slice('http:'.length)))
  const udpTargets = new Set(options.permissions.filter((p) => p.startsWith('udp:') || p.startsWith('osc:')).map((p) => p.slice(p.indexOf(':') + 1)))
  const declaredHelpers = new Set(options.permissions.filter((p) => p.startsWith('helper:')).map((p) => p.slice('helper:'.length)))
  let udp: ReturnType<typeof createSocket> | null = null

  async function http(raw: unknown): Promise<CapabilityResult> {
    const parsed = HttpRequest.safeParse(raw)
    if (!parsed.success) return fail('capability.invalid', 'capability.http needs {url, method?, headers?, body?}')
    let url = parsed.data.url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const origin = originOf(url)
      // Every hop is checked, the first request and each redirect target: an allowed origin must not be a way to reach another one.
      if (!origin || !allowedOrigins.has(origin)) return denied('http', origin ?? url)
      const response = await doFetch(url, { method: parsed.data.method ?? 'GET', headers: parsed.data.headers, body: parsed.data.body, redirect: 'manual' }).catch((err: unknown) => err as Error)
      if (response instanceof Error) return fail('http.failed', response.message)
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null
      if (location) {
        url = new URL(location, url).toString()
        continue
      }
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (declared > MAX_HTTP_BODY) return fail('http.too-large', `The answer is larger than ${MAX_HTTP_BODY / 1024 / 1024} MB`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > MAX_HTTP_BODY) return fail('http.too-large', `The answer is larger than ${MAX_HTTP_BODY / 1024 / 1024} MB`)
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => void (headers[key] = value))
      return { ok: true, body: { status: response.status, headers, body: new TextDecoder().decode(bytes) } }
    }
    return fail('http.too-many-redirects', 'Too many redirects')
  }

  async function sendUdp(raw: unknown): Promise<CapabilityResult> {
    const parsed = UdpRequest.safeParse(raw)
    if (!parsed.success) return fail('capability.invalid', 'capability.udp needs {host, port, bytes (<= 8192)}')
    const { host, port, bytes } = parsed.data
    if (!udpTargets.has(`${host}:${port}`)) return denied('udp', `${host}:${port}`)
    udp ??= createSocket('udp4')
    const socket = udp
    return new Promise((resolve) => socket.send(bytes, port, host, (err) => resolve(err ? fail('udp.failed', err.message) : { ok: true, body: {} })))
  }

  async function helper(raw: unknown): Promise<CapabilityResult> {
    const parsed = HelperRequest.safeParse(raw)
    if (!parsed.success) return fail('capability.invalid', 'capability.helper needs {helper, args, files?}')
    if (!declaredHelpers.has(parsed.data.helper)) return denied('helper', parsed.data.helper)
    try {
      return { ok: true, body: await options.helpers(parsed.data.helper, parsed.data.args, () => undefined, parsed.data.files) }
    } catch (err) {
      return fail('helper.error', err instanceof Error ? err.message : String(err))
    }
  }

  return async (method, body) => {
    if (method === 'capability.http') return http(body)
    if (method === 'capability.udp') return sendUdp(body)
    if (method === 'capability.helper') return helper(body)
    return fail('capability.unknown', `Unknown capability ${method}`)
  }
}
