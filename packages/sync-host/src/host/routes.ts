import {
  ActivateProfileRequestSchema,
  CreateMemberRequestSchema,
  JoinAsMemberRequestSchema,
  MasterHeartbeatReportSchema,
  PresenceReportSchema,
  RemoveMemberRequestSchema,
  ResetMemberPasswordRequestSchema,
  SetMemberAdminRequestSchema,
  SetOwnPinRequestSchema,
  VerifyAdminPinRequestSchema,
  type PresenceReport,
} from 'shared-types'
import type { z } from 'zod'
import type { BandJoin } from './bandJoin.js'
import type { BandMembers } from './bandMembers.js'
import type { LeaseStatus } from './leaseKeeper.js'

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
  /** JSON parsed; an upload as bytes. */
  body?: unknown
}

export interface HostRouteResponse {
  status: number
  /** JSON body; absent for 204 and for bytes. */
  body?: unknown
  binary?: { data: Uint8Array; contentType: string }
  /** Extra response headers (`Retry-After`). */
  headers?: Record<string, string>
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
  /** How a device becomes a member and an admin PIN is checked, for a band this host holds (null: not this host's band).
   * Absent: the host does not answer these routes (the Stage-Server until its accounts move into the band, #960). */
  joinBand?: (workspaceId: string) => BandJoin | null
  /** Who manages the members of a band this host holds (null: not this host's band). Absent: not registered. */
  members?: (workspaceId: string) => BandMembers | null
  /** false: not the band of this host. */
  presence: {
    report: (workspaceId: string, report: PresenceReport) => boolean
    heartbeat: (workspaceId: string, deviceId: string) => boolean
  }
}

const json = (status: number, body: unknown): HostRouteResponse => ({ status, body })
const fromJoin = (r: { status: number; body: unknown; headers?: Record<string, string> }): HostRouteResponse => ({ status: r.status, body: r.body, ...(r.headers ? { headers: r.headers } : {}) })
const passive = (): HostRouteResponse => json(503, { error: 'passive', reason: 'This host is the backup and is not serving the band.' })

/** `decodeURIComponent` that gives "" instead of throwing - an undecodable id is simply not a safe one. */
const safeDecode = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return ''
  }
}

/** The member routes: body checked first (400), then passive (503), then the band - one this host does not hold answers
 * like a wrong login, so it never tells which bands exist. */
function memberRoutes(membersOf: (workspaceId: string) => BandMembers | null, serving: () => boolean): HostRoute[] {
  const route = <T extends z.ZodType>(
    method: HostRoute['method'],
    pattern: string,
    schema: T,
    run: (members: BandMembers, profileId: string, body: z.infer<T>) => ReturnType<BandMembers['create']>,
  ): HostRoute => ({
    method,
    pattern,
    handle: async (request) => {
      const asked = schema.safeParse(request.body)
      if (!asked.success) return json(400, { status: 'error', message: asked.error.issues[0]?.message })
      if (!serving()) return passive()
      const members = membersOf(safeDecode(request.params.workspaceId ?? ''))
      if (!members) return json(403, { status: 'error', message: "Not this workspace's admin" })
      const answer = await run(members, safeDecode(request.params.profileId ?? ''), asked.data)
      return fromJoin(answer)
    },
  })
  const base = '/workspaces/:workspaceId'
  return [
    route('POST', `${base}/members`, CreateMemberRequestSchema, (m, _id, body) => m.create(body)),
    route('POST', `${base}/members/:profileId/admin`, SetMemberAdminRequestSchema, (m, id, body) => m.setAdmin(id, body)),
    route('DELETE', `${base}/members/:profileId`, RemoveMemberRequestSchema, (m, id, body) => m.remove(id, body)),
    route('POST', `${base}/members/:profileId/reset-password`, ResetMemberPasswordRequestSchema, (m, id, body) => m.resetPin(id, body)),
    route('POST', `${base}/members/:profileId/set-pin`, SetOwnPinRequestSchema, (m, id, body) => m.setOwnPin(id, body)),
    route('POST', `${base}/members/:profileId/activate`, ActivateProfileRequestSchema, (m, id, body) => m.activate(id, body)),
  ]
}

export function createHostRoutes(deps: HostRoutesDeps): HostRoute[] {
  const serving = () => deps.serving?.() ?? true
  const joinBand = deps.joinBand
  const membersOf = deps.members
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
    {
      method: 'POST',
      pattern: '/workspaces/:workspaceId/presence/report',
      handle: async (request) => {
        if (!serving()) return passive()
        const report = PresenceReportSchema.safeParse(request.body)
        if (!report.success) return json(400, { status: 'error', message: report.error.issues[0]?.message })
        return deps.presence.report(safeDecode(request.params.workspaceId ?? ''), report.data) ? { status: 204 } : json(404, { error: 'not_found', reason: 'Not the band of this host.' })
      },
    },
    {
      method: 'POST',
      pattern: '/workspaces/:workspaceId/master-heartbeat',
      handle: async (request) => {
        if (!serving()) return passive()
        const beat = MasterHeartbeatReportSchema.safeParse(request.body)
        if (!beat.success) return json(400, { status: 'error', message: beat.error.issues[0]?.message })
        return deps.presence.heartbeat(safeDecode(request.params.workspaceId ?? ''), beat.data.deviceId) ? { status: 204 } : json(404, { error: 'not_found', reason: 'Not the band of this host.' })
      },
    },
    ...(joinBand ? ([
    {
      method: 'POST',
      pattern: '/workspaces/:workspaceId/join/:profileId',
      handle: async (request) => {
        const asked = JoinAsMemberRequestSchema.safeParse(request.body)
        if (!asked.success) return json(400, { status: 'error', message: asked.error.issues[0]?.message })
        if (!serving()) return passive()
        // A band this host does not hold answers like a wrong code: it must not tell which bands exist.
        const band = joinBand(safeDecode(request.params.workspaceId ?? ''))
        if (!band) return json(403, { status: 'error', message: 'Wrong code' })
        return fromJoin(await band.join(safeDecode(request.params.profileId ?? ''), asked.data))
      },
    },
    {
      method: 'POST',
      pattern: '/workspaces/:workspaceId/verify-admin-pin',
      handle: async (request) => {
        const asked = VerifyAdminPinRequestSchema.safeParse(request.body)
        if (!asked.success) return json(400, { status: 'error', message: asked.error.issues[0]?.message })
        if (!serving()) return passive()
        const band = joinBand(safeDecode(request.params.workspaceId ?? ''))
        if (!band) return json(403, { status: 'error', message: 'Wrong admin or PIN' })
        return fromJoin(await band.verifyPin(asked.data))
      },
    },
    ] satisfies HostRoute[]) : []),
    ...(membersOf ? memberRoutes(membersOf, serving) : []),
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
