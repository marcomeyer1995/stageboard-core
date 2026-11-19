import { FlashReportSchema, MasterHeartbeatReportSchema, PresenceReportSchema, ReadyReportSchema } from 'shared-types'
import type { LeaseStatus } from './leaseKeeper.js'
import type { HostPresence } from './presence.js'

/**
 * The routes every host answers the same way (host module, #949): who it is, the alive signal, the band
 * invitation, the login for the copy, audio, presence and the master's heartbeat. One table, in the shape both
 * platforms can use as it is: the laptop registers each entry with Fastify (`pattern` is Fastify's own
 * `:param` notation), the tablet matches an incoming path against it (`matchHostRoute`). No Node API, no
 * DOM; what differs between the platforms comes in through `HostRoutesDeps`.
 *
 * Not here (platform-specific for now): the streams (Fastify's raw reply / the native server), the database
 * proxy and its logins, `/server-info`, and the roster.
 */

export interface HostRouteRequest {
  method: string
  path: string
  /** `:name` segments of the pattern, as they stand in the path (still URL-encoded). */
  params: Readonly<Record<string, string>>
  query: Readonly<Record<string, string>>
  /** The `Authorization` header, if the request carried one. */
  authorization?: string
  /** JSON parsed; an upload as bytes. */
  body?: unknown
}

export interface HostRouteResponse {
  status: number
  /** JSON body; absent for 204 and for bytes. */
  body?: unknown
  binary?: { data: Uint8Array; contentType: string }
}

export interface HostRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Fastify-style, e.g. `/workspaces/:workspaceId/master-heartbeat`. */
  pattern: string
  handle: (request: HostRouteRequest) => Promise<HostRouteResponse>
}

/** The audio tracks a host holds, by variant and track. Bytes in, bytes out. */
export interface HostAudio {
  get: (variantId: string, trackId: string) => Promise<Uint8Array | null>
  put: (variantId: string, trackId: string, data: Uint8Array) => Promise<void>
  remove: (variantId: string, trackId: string) => Promise<void>
}

/** An id becomes part of a storage key, so no separators or control characters (the Stage-Server's rule). */
const SAFE_AUDIO_ID = /^[a-zA-Z0-9-]+$/
export const isSafeAudioId = (id: string): boolean => SAFE_AUDIO_ID.test(id)

/** The part of the lease service the routes read and feed. */
export interface HostRoutesLease {
  bandTime(): number
  epoch(): number
  /** The host is the band's host right now - what `/time` announces. */
  isBandHost(): boolean
  /** The host has taken over (the role), which is what a lease answer reports. */
  isActive(): boolean
  outdated(): boolean
  status(): LeaseStatus | null
  clockOffsetMs(): number | null
  receive(raw: unknown): Promise<'accepted' | 'ignored'>
}

export interface HostRoutesDeps {
  hostId: string
  lease: HostRoutesLease
  /** The band this host is set up for - null for a fresh backup that has none yet (the primary invites it then). */
  activeWorkspaceId: () => string | null
  /** Whether this host serves the band right now. Audio and presence are refused with 503 while it does not - a
   * passive backup serves nothing. Absent: always (the Stage-Server's behaviour so far). */
  serving?: () => boolean
  /** More fields for `/server/host-lease` (the laptop adds its copy and the audio mirror). */
  hostLeaseExtra?: () => Record<string, unknown>
  /** The primary teaching this host its band (#945). */
  acceptInvite: (raw: unknown) => Promise<{ ok: true } | { ok: false; status: number; message: string }>
  /** The returned primary asking for a login to copy this host's data (#919). */
  issueAccount: (raw: unknown) => Promise<{ username: string; password: string } | null>
  audio: HostAudio
  /** The presence store (`createHostPresence`): reports, the master's heartbeat, the Ready Check and flash messages land here. */
  presence: HostPresence
  /** false: this host does not serve that band (the tablet serves one; absent: every band, as the Stage-Server does). */
  servesBand?: (workspaceId: string) => boolean
  /** Whether the login in `authorization` is a device of the band - a flash message puts text onto every tablet, so it
   * needs one (the reports do not: they only tell which already-visible roster member is active). */
  isBandDevice: (workspaceId: string, authorization: string | undefined) => Promise<boolean>
}

const json = (status: number, body: unknown): HostRouteResponse => ({ status, body })
const passive = (): HostRouteResponse => json(503, { error: 'passive', reason: 'This host is the backup and is not serving the band.' })

/** `decodeURIComponent` that gives "" instead of throwing - an undecodable id is simply not a safe one. */
const safeDecode = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return ''
  }
}

export function createHostRoutes(deps: HostRoutesDeps): HostRoute[] {
  const serving = () => deps.serving?.() ?? true
  const notThisBand = () => json(404, { error: 'not_found', reason: 'Not the band of this host.' })
  /** A report route: refused while passive, for another band, or for a body that does not fit; else `record` and 204. */
  const presenceRoute = <T,>(pattern: string, schema: { safeParse: (body: unknown) => { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, record: (workspaceId: string, body: T) => void): HostRoute => ({
    method: 'POST',
    pattern,
    handle: async (request) => {
      if (!serving()) return passive()
      const workspaceId = safeDecode(request.params.workspaceId ?? '')
      if (deps.servesBand && !deps.servesBand(workspaceId)) return notThisBand()
      const parsed = schema.safeParse(request.body)
      if (!parsed.success) return json(400, { status: 'error', message: parsed.error.issues[0]?.message })
      record(workspaceId, parsed.data)
      return { status: 204 }
    },
  })
  const audioIds = (params: HostRouteRequest['params']) => ({ variantId: safeDecode(params.variantId ?? ''), trackId: safeDecode(params.trackId ?? '') })

  return [
    { method: 'GET', pattern: '/time', handle: async () => json(200, { serverTime: deps.lease.bandTime(), hostId: deps.hostId, epoch: deps.lease.epoch(), active: deps.lease.isBandHost() }) },
    { method: 'GET', pattern: '/server/active-workspace', handle: async () => json(200, { activeWorkspaceId: deps.activeWorkspaceId() }) },
    {
      method: 'GET',
      pattern: '/server/host-lease',
      handle: async () =>
        json(200, { lease: deps.lease.status(), clockOffsetMs: deps.lease.clockOffsetMs(), active: deps.lease.isActive(), epoch: deps.lease.epoch(), outdated: deps.lease.outdated(), ...(deps.hostLeaseExtra?.() ?? {}) }),
    },
    {
      method: 'POST',
      pattern: '/host/lease',
      handle: async (request) => {
        const accepted = (await deps.lease.receive(request.body)) === 'accepted'
        return json(200, { accepted, epoch: deps.lease.epoch(), active: deps.lease.isActive() })
      },
    },
    {
      method: 'POST',
      pattern: '/host/join-band-invite',
      handle: async (request) => {
        const result = await deps.acceptInvite(request.body)
        return result.ok ? json(200, { status: 'ok' }) : json(result.status, { status: 'error', message: result.message })
      },
    },
    {
      method: 'POST',
      pattern: '/host/replication-account',
      handle: async (request) => {
        const account = await deps.issueAccount(request.body)
        return account ? json(200, account) : json(403, {})
      },
    },
    {
      method: 'GET',
      pattern: '/audio/:variantId/:trackId',
      handle: async (request) => {
        if (!serving()) return passive()
        const { variantId, trackId } = audioIds(request.params)
        if (!isSafeAudioId(variantId) || !isSafeAudioId(trackId)) return json(400, { status: 'error', message: 'Invalid variantId or trackId' })
        const data = await deps.audio.get(variantId, trackId)
        // The client carries the real mime type in the track's own data and builds its Blob with it.
        return data === null ? json(404, { status: 'error', message: 'Track not found' }) : { status: 200, binary: { data, contentType: 'application/octet-stream' } }
      },
    },
    {
      method: 'PUT',
      pattern: '/audio/:variantId/:trackId',
      handle: async (request) => {
        if (!serving()) return passive()
        const { variantId, trackId } = audioIds(request.params)
        if (!isSafeAudioId(variantId) || !isSafeAudioId(trackId)) return json(400, { status: 'error', message: 'Invalid variantId or trackId' })
        if (!(request.body instanceof Uint8Array)) return json(400, { status: 'error', message: 'A track is sent as bytes' })
        await deps.audio.put(variantId, trackId, request.body)
        return { status: 204 }
      },
    },
    {
      method: 'DELETE',
      pattern: '/audio/:variantId/:trackId',
      handle: async (request) => {
        if (!serving()) return passive()
        const { variantId, trackId } = audioIds(request.params)
        if (!isSafeAudioId(variantId) || !isSafeAudioId(trackId)) return json(400, { status: 'error', message: 'Invalid variantId or trackId' })
        await deps.audio.remove(variantId, trackId)
        return { status: 204 }
      },
    },
    presenceRoute('/workspaces/:workspaceId/presence/report', PresenceReportSchema, (ws, report) => deps.presence.setEntry(ws, report.deviceId, report.profileId)),
    presenceRoute('/workspaces/:workspaceId/master-heartbeat', MasterHeartbeatReportSchema, (ws, beat) => deps.presence.setMasterHeartbeat(ws, beat.deviceId)),
    presenceRoute('/workspaces/:workspaceId/ready-check/report', ReadyReportSchema, (ws, answer) => deps.presence.setReady(ws, answer.checkId, answer.profileId)),
    {
      method: 'POST',
      pattern: '/workspaces/:workspaceId/flash',
      handle: async (request) => {
        if (!serving()) return passive()
        const workspaceId = safeDecode(request.params.workspaceId ?? '')
        if (deps.servesBand && !deps.servesBand(workspaceId)) return notThisBand()
        // A body that is no message is 400 for anyone (it tells a stranger nothing); only then is the login asked.
        const flash = FlashReportSchema.safeParse(request.body)
        if (!flash.success) return json(400, { status: 'error', message: flash.error.issues[0]?.message })
        if (!(await deps.isBandDevice(workspaceId, request.authorization))) return json(401, { status: 'error', message: 'Only a device of this band can send flash messages' })
        return json(201, deps.presence.setFlash(workspaceId, flash.data.text, flash.data.from, flash.data.to))
      },
    },
  ]
}

/** The route a request path and method belong to, with its params - for a platform that has no router of its own. */
export function matchHostRoute(routes: readonly HostRoute[], method: string, path: string): { route: HostRoute; params: Record<string, string> } | null {
  const clean = path.length > 1 ? path.replace(/\/+$/, '') : path
  const parts = clean.split('/')
  for (const route of routes) {
    if (route.method !== method.toUpperCase()) continue
    const pattern = route.pattern.split('/')
    if (pattern.length !== parts.length) continue
    const params: Record<string, string> = {}
    let ok = true
    for (let i = 0; i < pattern.length; i++) {
      const want = pattern[i]!
      if (want.startsWith(':')) params[want.slice(1)] = parts[i]!
      else if (want !== parts[i]) {
        ok = false
        break
      }
    }
    if (ok) return { route, params }
  }
  return null
}
