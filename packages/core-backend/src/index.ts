import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import httpProxy from '@fastify/http-proxy'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import {
  ActivateProfileRequestSchema,
  ActivateWorkspaceHardwareRequestSchema,
  CreateMemberRequestSchema,
  DeviceInfoReportSchema,
  DeviceTriggerSchema,
  DiscoveryAssignRequestSchema,
  DiscoveryReportCandidateRequestSchema,
  DiscoveryStartRequestSchema,
  DiscoveryTriggeredRequestSchema,
  HealthReportSchema,
  GetAccessCodeRequestSchema,
  JoinAsMemberRequestSchema,
  MasterHeartbeatReportSchema,
  PresenceReportSchema,
  ReadyReportSchema,
  RemoveMemberRequestSchema,
  RenameWorkspaceRequestSchema,
  SetMasterModeRequestSchema,
  ResetMemberPasswordRequestSchema,
  RevokeDeviceRequestSchema,
  ForgetDeviceRequestSchema,
  RosterRequestSchema,
  RotateAccessCodeRequestSchema,
  SetMemberAdminRequestSchema,
  SetOwnPinRequestSchema,
  ShowControlEventSchema,
  VerifyAdminPinRequestSchema,
  WorkspaceDeleteRequestSchema,
  WorkspaceProvisionRequestSchema,
  type Device,
} from 'shared-types'
import { BackupAdminRequestSchema, BackupSaveRequestSchema, BackupTargetRequestSchema, FlashReportSchema, ShowStatePushAckSchema, ShowStatePushSchema } from 'shared-types'
import { createBackupService, realBackupDeps, type BackupService } from './backup.js'
import { deleteAudioFile, isSafeAudioId, readAudioFile, writeAudioFile } from './audioStore.js'
import { readPersistedActiveWorkspace } from './activeWorkspaceStateStore.js'
import { isSafePluginId, readPluginBundle } from './plugins/pluginBundleStore.js'
import { allDocs, deleteDocUnless, getDoc, putDoc, putDocWithRetry, userExists, verifyUser, type CouchConfig, type CouchDoc } from './couch.js'
import * as deviceInfoStore from './deviceInfoStore.js'
import * as deviceRelay from './deviceRelay.js'
import * as discoverySessionStore from './discoverySessionStore.js'
import { installShutdownHandlers, trackConnections } from './gracefulShutdown.js'
import { registerAppRoutes } from './appDownload.js'
import { certFingerprint } from './certFingerprint.js'
import { startMdnsResponder } from './mdnsResponder.js'
import { startPingLoop } from './pingLoop.js'
import * as healthStore from './plugins/healthStore.js'
import { LOOKUP_CATALOG } from './plugins/lookupCatalog.js'
import { LookupRegistry } from './plugins/lookupRegistry.js'
import { lookupErrorBody } from './plugins/lookupError.js'
import * as presenceStore from './presenceStore.js'
import * as showStatePushHub from './showStatePushHub.js'
import { PluginRegistry } from './plugins/registry.js'
import { createPinThrottle } from './pinThrottle.js'
import { isLoopback, readDeletedWorkspaces } from './provisioningAuth.js'
import { listDbs } from './couch.js'
import { createWorkspaceHardwareController } from './workspaceHardwareController.js'
import {
  deprovisionMember,
  deprovisionWorkspace,
  generateMemberPassword,
  deviceUsername,
  getOrCreateAccessCode,
  listWorkspaces,
  memberUsername,
  provisionDevice,
  provisionMember,
  provisionWorkspace,
  updateRosterValidators,
  renameWorkspace,
  setMasterMode,
  resetAdminPin,
  rotateAccessCode,
  setMemberAdmin,
  setMemberPassword,
  workspaceDbName,
  WorkspaceAlreadyProvisionedError,
} from './workspaceProvisioning.js'

const certFile = fileURLToPath(new URL('../../../certs/dev-cert.pem', import.meta.url))
const keyFile = fileURLToPath(new URL('../../../certs/dev-key.pem', import.meta.url))
/** Computed once, at module load: whether this server will actually listen over HTTPS (see
 * `buildApp()`/`main()` below, both of which gate on this same cert-presence check). The
 * default FRONTEND_ORIGIN below derives its scheme from this too - it used to be hardcoded to
 * `http://`, which silently CORS-blocked every cross-origin PUT/DELETE (audio upload/delete,
 * DELETE /workspaces/:id) whenever this ran alongside the frontend's own equally cert-gated
 * HTTPS dev server (vite.config.ts) without FRONTEND_ORIGIN being set by hand - found live,
 * 2026-09-13, tracked down via a track upload silently failing with "Failed to fetch". */
const CERTS_AVAILABLE = existsSync(certFile) && existsSync(keyFile)
/** `localhost` for whoever opens this dev server directly, `stageboard.local` for the mDNS
 * name devices normally use (docs/03) - covers both without requiring FRONTEND_ORIGIN to be
 * set by hand for the common cases. `https://localhost` is the native Android app's own origin
 * (Capacitor, #348): its UI is bundled in the APK, so every server call is cross-origin. */
const DEFAULT_FRONTEND_ORIGINS = [
  `${CERTS_AVAILABLE ? 'https' : 'http'}://localhost:5173`,
  `${CERTS_AVAILABLE ? 'https' : 'http'}://stageboard.local:5173`,
  'https://localhost',
].join(',')

/**
 * Why a request through the `/db` proxy must not reach CouchDB, or null if it may: a path into a
 * band's database (`/db/stageboard-<band>/…`) needs Basic auth with an account of that band
 * (`stageboard-<band>-<profile>[~<device>]`). Everything else (`_session`, `_users`, …) is left to
 * CouchDB. Band ids never extend each other (checked at provisioning), so the prefix is unambiguous.
 */
export function bandDbProxyRefusal(url: string, authorization: string | undefined): string | null {
  const path = url.slice('/db'.length).split('?')[0] ?? ''
  let first: string
  try {
    first = path.split('/').map((segment) => decodeURIComponent(segment)).find((segment) => segment !== '') ?? ''
  } catch {
    return 'bad path'
  }
  if (first === '.' || first === '..' || first.includes('/')) return 'bad path'
  if (!first.startsWith('stageboard-')) return null
  const login = basicAuthCredentials(authorization)
  if (!login) return 'no band login'
  return login.username.startsWith(`${first}-`) ? null : 'account of another band'
}

/** Username and password from an `Authorization: Basic …` header, or null. */
export function basicAuthCredentials(header: string | undefined): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon <= 0) return null
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
}

/** SHA-256 fingerprint of the server's certificate (lowercase hex, no separators), or null
 * without HTTPS. The native app pins exactly this certificate when pairing (#348) - the invite
 * QR code carries it, so a self-signed certificate is trusted without any CA on the device. */
const CERT_FINGERPRINT = CERTS_AVAILABLE ? certFingerprint(readFileSync(certFile, 'utf8')) : null

/** True if `username`/`password` authenticate as a genuine admin *of this specific workspace*
 * (see per-person-accounts follow-up) - every admin-gated route below uses this instead of
 * comparing against one fixed, derivable username. `verifyUser` already confirms the
 * credentials are real; this just adds the role check. */
async function verifyAdmin(couch: CouchConfig, username: string, password: string): Promise<boolean> {
  const verified = await verifyUser(couch, username, password)
  return verified !== null && verified.roles.includes('admin')
}

const PROFILE_ID_PREFIX = 'profiles:'

/** How many roster members other than `excludingProfileId` currently have `stageRoles`
 * including `'admin'` - the source of truth for the "at least one admin must remain" checks
 * below. Reads the roster itself (not CouchDB `_users`) since the roster's `stageRoles` field
 * and each account's actual CouchDB role are meant to always move together (the frontend
 * updates both in the same action) - the roster is the simpler, single query. */
async function countOtherAdmins(couch: CouchConfig, workspaceId: string, excludingProfileId: string): Promise<number> {
  const profiles = await allDocs<CouchDoc & { id?: string; stageRoles?: string[] }>(couch, workspaceDbName(workspaceId), {
    startkey: PROFILE_ID_PREFIX,
    endkey: `${PROFILE_ID_PREFIX}￰`,
  })
  return profiles.filter((profile) => profile.id !== excludingProfileId && (profile.stageRoles ?? []).includes('admin')).length
}

/** The roster as shown to a device mid-join (`POST /workspaces/:id/roster`, 2026-09-01
 * WiFi-style redesign) - every profile, deliberately without `requiresPassword` anymore
 * (2026-09-02 second follow-up): only `isAdmin` decides whether the joining device needs to
 * prompt for a code at all, see `RosterMemberSchema`'s doc comment in shared-types for the
 * full reasoning. */
async function readRoster(couch: CouchConfig, workspaceId: string) {
  const profiles = await allDocs<CouchDoc & { id?: string; name?: string; stageRoles?: string[] }>(
    couch,
    workspaceDbName(workspaceId),
    { startkey: PROFILE_ID_PREFIX, endkey: `${PROFILE_ID_PREFIX}￰` },
  )
  return profiles.map((profile) => ({
    profileId: profile.id!,
    name: profile.name!,
    isAdmin: (profile.stageRoles ?? []).includes('admin'),
  }))
}

/** Either a resolved set of credentials to hand back (200 for verified/reissued, 201 for a
 * freshly-provisioned account), or an error to relay as-is - the discriminant `resolveOutcome`
 * (below) returns, shared by both routes that can resolve "who is this profile, really" (the
 * public band-code-gated join route and the caller-credential-gated activate route) so the
 * admin/non-admin rules below live in exactly one place. */
type ResolveOutcome =
  | { ok: true; code: 200 | 201; body: { username: string; password: string; isAdmin: boolean } }
  | { ok: false; code: 400 | 403 | 404; message: string }

/**
 * The shared second half of both "become this roster member" routes, once each has already
 * checked its own proof of trust (the join route: the workspace's standing code; the activate
 * route: the calling device's own existing credentials for this workspace).
 *
 * 2026-09-02 second follow-up, at Marco's explicit request (after getting locked out testing
 * the *first* follow-up's design, twice in one day): only admin accounts have any password
 * concept at all now.
 *
 * 2026-09-04 follow-up, found live: every successful path here now hands back `deviceId`'s *own*
 * account (`provisionDevice`) rather than the profile's shared one - the whole point being that
 * several tablets can hold the same roster identity at once without one's (re-)join silently
 * rotating a password every other tablet had already cached (see `deviceUsername`'s doc comment,
 * workspaceProvisioning.ts). `memberUsername`'s account still exists per profile, but purely as
 * an *anchor* now: for an admin it's just where the human PIN lives for `verifyUser` to check,
 * never itself returned to a client; a non-admin's anchor is created once and never looked at
 * again, purely so `exists` below has something durable to test.
 *
 * - **Non-admin target**: no password check, ever - `password` is ignored entirely. Mints (or
 *   reissues, if this exact device already has one) that device's own account
 *   (`provisionDevice`) - nobody, including whoever created the roster entry, ever sets or knows
 *   a non-admin's password anyway.
 * - **Admin target, account exists**: `password` must equal either that admin's own current PIN
 *   (`verifyUser` against the anchor) *or* `accessCodeSuffix` - the workspace's own standing
 *   access code's last 4 digits, which always works for *any* admin account here. Either way,
 *   the anchor itself is never touched - only `deviceId`'s own account is minted/reissued.
 * - **Admin target, no account yet**: a valid 4-digit `password` becomes that admin's own
 *   initial self-assigned PIN, written to a freshly-created anchor (`provisionMember`) - then
 *   `deviceId` still gets its own separate account for actual syncing, same as every other path.
 *   In practice every roster entry already gets an anchor the moment it's created
 *   (`provisionMember`/`provisionWorkspace`), admin or not, so this only exists as a defensive
 *   fallback, not a path real traffic is expected to hit.
 */
async function resolveOutcome(
  couch: CouchConfig,
  workspaceId: string,
  profileId: string,
  deviceId: string,
  password: string | undefined,
  accessCodeSuffix: string,
): Promise<ResolveOutcome> {
  const profile = await getDoc<CouchDoc & { stageRoles?: string[] }>(couch, workspaceDbName(workspaceId), `${PROFILE_ID_PREFIX}${profileId}`)
  if (!profile) {
    return { ok: false, code: 404, message: 'Unknown roster member' }
  }
  const profileIsAdmin = (profile.stageRoles ?? []).includes('admin')
  const anchorUsername = memberUsername(workspaceId, profileId)
  const exists = await userExists(couch, anchorUsername)

  if (!profileIsAdmin) {
    if (!exists) {
      await provisionMember(couch, workspaceId, profileId, generateMemberPassword(), false)
    }
    const credentials = await provisionDevice(couch, workspaceId, profileId, deviceId, false)
    return { ok: true, code: exists ? 200 : 201, body: { ...credentials, isAdmin: false } }
  }

  if (!exists) {
    if (!password || !/^\d{4}$/.test(password)) {
      return { ok: false, code: 400, message: 'Admin accounts need a 4-digit PIN' }
    }
    await provisionMember(couch, workspaceId, profileId, password, true)
    const credentials = await provisionDevice(couch, workspaceId, profileId, deviceId, true)
    return { ok: true, code: 201, body: { ...credentials, isAdmin: true } }
  }

  if (!password) {
    return { ok: false, code: 403, message: 'Admin accounts require a code' }
  }
  if (password === accessCodeSuffix) {
    const credentials = await provisionDevice(couch, workspaceId, profileId, deviceId, true)
    return { ok: true, code: 200, body: { ...credentials, isAdmin: true } }
  }
  const verified = await verifyUser(couch, anchorUsername, password)
  if (!verified) {
    return { ok: false, code: 403, message: 'Wrong code' }
  }
  const isAdmin = verified.roles.includes('admin')
  const credentials = await provisionDevice(couch, workspaceId, profileId, deviceId, isAdmin)
  return { ok: true, code: 200, body: { ...credentials, isAdmin } }
}

/**
 * True if `profileId` is a real roster admin of `workspaceId` and `pin` is either their own PIN
 * or the workspace's universal recovery code (its access code's last 4 digits) - the exact
 * proof `resolveOutcome`'s admin path accepts, but as a pure check: nothing is provisioned,
 * rotated, or handed back. Used by the hardware-switch wizard, which only needs to know "is this
 * genuinely that band's admin", not to become them on any device.
 *
 * Deliberately not `activateProfile`'s route: that one short-circuits (no PIN check at all) when
 * a device re-picks its own already-active profile, so it can't prove anything about a PIN.
 */
async function verifyAdminPin(couch: CouchConfig, workspaceId: string, profileId: string, pin: string): Promise<boolean> {
  const profile = await getDoc<CouchDoc & { stageRoles?: string[] }>(couch, workspaceDbName(workspaceId), `${PROFILE_ID_PREFIX}${profileId}`)
  if (!profile || !(profile.stageRoles ?? []).includes('admin')) return false

  const accessCode = await getOrCreateAccessCode(couch, workspaceId, workspaceId)
  if (pin === accessCode.code.slice(-4)) return true

  const verified = await verifyUser(couch, memberUsername(workspaceId, profileId), pin)
  return verified !== null && verified.roles.includes('admin')
}

/**
 * Hijacks `reply` and opens it as a push SSE stream - shared by every subscription route below
 * (plugin-health, presence, trigger-stream, discovery). Copies whatever headers Fastify already
 * queued (e.g. CORS from the cors plugin's onRequest hook) individually, since `writeHead()` has
 * no overload accepting an arbitrary header record alongside a status code.
 *
 * `Connection: keep-alive` is only set for an HTTP/1.x client: HTTP/2 forbids "connection-
 * specific" header fields entirely (RFC 7540 §8.1.2.2 - h2 multiplexes many logical streams over
 * one already-persistent connection, so the header is meaningless there anyway), and Node's h2
 * compat layer throws `ERR_HTTP2_INVALID_CONNECTION_HEADER` if it's set on a real h2 stream
 * (#129's `http2: true` + `allowHTTP1: true`) - `request.raw.httpVersionMajor` tells us which
 * protocol this particular request actually negotiated.
 */
/** Band logins already verified (key: workspace + Authorization header), until when (ms). */
const verifiedBandLogins = new Map<string, number>()
const BAND_LOGIN_CACHE_MS = 10 * 60 * 1000

function beginSseStream(request: FastifyRequest, reply: FastifyReply): void {
  reply.hijack()
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) reply.raw.setHeader(name, value)
  }
  reply.raw.setHeader('Content-Type', 'text/event-stream')
  reply.raw.setHeader('Cache-Control', 'no-cache')
  if (request.raw.httpVersionMajor < 2) reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.writeHead(200)
}

/**
 * Wires up the Fastify instance and every route, with fresh, empty plugin registries - no
 * CouchDB sync, no LOOKUP_CATALOG registration, no `listen()`. Split out from `main()` so
 * tests can exercise real routes via `.inject()` without any of that I/O; `main()` is the
 * only caller that goes on to populate the registries and actually start the server.
 */
export async function buildApp(options: { backupService?: BackupService } = {}) {
  // Same shared cert as Vite and CouchDB (see #34, scripts/generate-dev-certs.sh) - the
  // tablet's WebMIDI/getUserMedia calls need the *page* origin to be secure, not this
  // server, but WSS/HTTPS here still matters once the PWA itself is HTTPS: an HTTPS page
  // fetching a plain-HTTP API is mixed content and gets blocked. Falls back to plain HTTP
  // if the certs haven't been generated yet, same as vite.config.ts.
  // Cast away the HTTP-vs-HTTPS server generic once, here: every route handler, `.inject()`
  // caller, and `main()`'s `.listen()` only use transport-agnostic Fastify methods, never
  // the underlying `server` property directly, so one shared `FastifyInstance` type serves
  // both branches without spreading this union through every consumer.
  // Audio track uploads (see #30) regularly exceed Fastify's 1 MB default bodyLimit -
  // this is a LAN-only server (docs/01), so a generous ceiling costs nothing real.
  const bodyLimit = Number(process.env.MAX_AUDIO_UPLOAD_BYTES ?? 200 * 1024 * 1024)

  // Admin CouchDB credentials - core-backend is the trusted, physically-secured Stage-Server
  // process, so unlike the PWA (see #12) it keeps using these directly, both for its own
  // plugin-sync data access and for the /workspaces provisioning route below, which needs
  // admin rights to create CouchDB users and databases.
  const couch: CouchConfig = {
    url: process.env.COUCHDB_URL ?? 'http://localhost:5984',
    user: process.env.COUCHDB_USER ?? 'admin',
    password: process.env.COUCHDB_PASSWORD ?? 'admin',
  }
  /** Whether `authorization` is a login of this band (its CouchDB user) - remembered for
   * BAND_LOGIN_CACHE_MS, so a Play doesn't wait for a database round trip each time. */
  async function isBandDevice(workspaceId: string, authorization: string | undefined): Promise<boolean> {
    const key = `${workspaceId}|${authorization ?? ''}`
    if ((verifiedBandLogins.get(key) ?? 0) > Date.now()) return true
    const login = basicAuthCredentials(authorization)
    if (!login || !login.username.startsWith(`${workspaceDbName(workspaceId)}-`)) return false
    if ((await verifyUser(couch, login.username, login.password)) === null) return false
    verifiedBandLogins.set(key, Date.now() + BAND_LOGIN_CACHE_MS)
    return true
  }


  // HTTP/2 (#129): browsers only ever negotiate h2 over TLS (ALPN), so this only applies to the
  // HTTPS branch - the plain-HTTP fallback below (no certs generated yet) stays HTTP/1.1, same
  // as it always was. `allowHTTP1: true` keeps any client that can't/won't negotiate h2 working
  // unchanged. One physical connection per origin with 100+ multiplexed logical streams removes
  // the browser's ~6-connections-per-origin ceiling this app was already sitting at/near (5 SSE
  // streams open per tab) - see the issue for the full story.
  const app: FastifyInstance =
    CERTS_AVAILABLE
      ? (Fastify({
          logger: true,
          bodyLimit,
          http2: true,
          https: { allowHTTP1: true, cert: readFileSync(certFile), key: readFileSync(keyFile) },
        }) as unknown as FastifyInstance)
      : Fastify({ logger: true, bodyLimit })

  // Tablets fetch this cross-origin (their own dev-server or PWA origin, not this server's) -
  // same FRONTEND_ORIGIN convention as scripts/setup-couchdb.sh's CouchDB CORS setup.
  //
  // `methods` isn't derived from whatever routes actually exist - @fastify/cors defaults it to
  // the static string 'GET,HEAD,POST' if left unset, silently CORS-blocking every cross-origin
  // PUT/DELETE/PATCH (audio upload/delete, and now DELETE /workspaces/:id) at the browser's
  // preflight step, before the request even reaches a route handler. Found live, 2026-08-30:
  // DELETE /workspaces/:id's own test suite never caught this because fastify.inject() doesn't
  // go through real CORS at all.
  await app.register(cors, {
    origin: (process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGINS).split(','),
    methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
    // Every PouchDB request through the /db proxy below sends `credentials: 'include'` (it
    // needs that for its own Basic Auth header) - without this, @fastify/cors never sends
    // Access-Control-Allow-Credentials at all, so the browser blocks the preflight outright
    // ("the value of the 'Access-Control-Allow-Credentials' header ... is '' which must be
    // 'true'"), and every live PouchDB<->CouchDB sync fails forever, retrying with backoff
    // (Marco, 2026-09-14).
    credentials: true,
  })

  app.get('/health', async () => ({ status: 'ok' }))

  // The NTP-style "burst handshake" target (docs/00 §4, #31): clients hit this repeatedly and
  // keep the lowest-RTT sample's offset (see stage-pwa's clockSync.ts) - a single Date.now()
  // read is all a client needs, no session/state on this end.
  app.get('/time', async () => ({ serverTime: Date.now() }))

  // Lets InviteBandView.tsx embed a *reachable* address in its QR code (see #21 seventh
  // follow-up, at Marco's explicit request) rather than baking one host in forever - detected
  // fresh on every call (not cached at startup like main()'s own `lanIp`), so "Einladen"
  // printing a stale IP after a DHCP lease change is a re-open of that screen away, not a
  // server restart away. No auth: this is the same address the mDNS responder already
  // broadcasts to anything listening on the LAN, not new information.
  //
  // `hostname` (Device Ledger follow-up) is the same `MDNS_HOSTNAME` value the mDNS responder
  // below already broadcasts - exposed here too for a device that's never seen that broadcast
  // (e.g. connected via a typed raw IP) but still wants to show this box's name, not just its
  // address.
  app.get('/server-info', async () => ({
    lanIp: process.env.LAN_IP ?? detectLanIp(),
    hostname: process.env.MDNS_HOSTNAME ?? 'stageboard.local',
    certFingerprint: CERT_FINGERPRINT,
  }))

  // Audio tracks arrive as whatever mime type the browser's Blob carries (audio/mpeg,
  // audio/wav, ...) - Fastify only parses application/json and text/plain by default, so
  // anything else needs an explicit parser or gets rejected as unsupported media type.
  // A '*' fallback only ever applies to content types with no more specific parser
  // registered, so this doesn't touch the existing JSON routes above/below it.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, payload, done) => {
    done(null, payload)
  })

  app.put('/audio/:variantId/:trackId', async (request, reply) => {
    const { variantId, trackId } = request.params as { variantId: string; trackId: string }
    if (!isSafeAudioId(variantId) || !isSafeAudioId(trackId)) {
      return reply.status(400).send({ status: 'error', message: 'Invalid variantId or trackId' })
    }
    await writeAudioFile(variantId, trackId, request.body as Buffer)
    return reply.status(204).send()
  })

  app.get('/audio/:variantId/:trackId', async (request, reply) => {
    const { variantId, trackId } = request.params as { variantId: string; trackId: string }
    if (!isSafeAudioId(variantId) || !isSafeAudioId(trackId)) {
      return reply.status(400).send({ status: 'error', message: 'Invalid variantId or trackId' })
    }
    const data = await readAudioFile(variantId, trackId)
    if (data === null) {
      return reply.status(404).send({ status: 'error', message: 'Track not found' })
    }
    // The client already carries the real mime type in TrackMeta (synced as plain JSON)
    // and builds its own Blob with it - this response doesn't need to track or guess it.
    return reply.type('application/octet-stream').send(data)
  })

  app.delete('/audio/:variantId/:trackId', async (request, reply) => {
    const { variantId, trackId } = request.params as { variantId: string; trackId: string }
    if (!isSafeAudioId(variantId) || !isSafeAudioId(trackId)) {
      return reply.status(400).send({ status: 'error', message: 'Invalid variantId or trackId' })
    }
    await deleteAudioFile(variantId, trackId)
    return reply.status(204).send()
  })

  // Named '/plugin-health', not '/health', to avoid colliding with the plain server-liveness
  // route above - this is a different concept (per-plugin reachability, not "is this
  // process up"). SSE, not WebSocket: the traffic is one-directional broadcast plus
  // occasional one-shot reports, which fits a kept-open Fastify reply and a plain POST with
  // no new dependency (see #49 follow-up - this replaces the old CouchDB `plugin-health` doc).
  app.get('/plugin-health/:workspaceId/stream', (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    beginSseStream(request, reply)

    const unsubscribe = healthStore.subscribe(workspaceId, (snapshot) => {
      reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`)
    })
    request.raw.on('close', unsubscribe)
  })

  app.post('/plugin-health/:workspaceId/report', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = HealthReportSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    healthStore.setEntry(workspaceId, parsed.data.pluginName, {
      status: parsed.data.status,
      lastSeenAt: Date.now(),
      message: parsed.data.message,
    })
    return reply.status(204).send()
  })

  // "Who's currently logged in, from how many devices" (see #21 ninth follow-up, at Marco's
  // explicit request) - same SSE push pattern as plugin-health above, just keyed by deviceId
  // instead of plugin name (presenceStore.ts). No auth on either route: presence only reveals
  // which already-visible roster member is active right now, nothing a workspace's own access
  // code doesn't already gate getting this far to see.
  app.get('/workspaces/:workspaceId/presence/stream', (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    beginSseStream(request, reply)

    const unsubscribe = presenceStore.subscribe(workspaceId, (snapshot) => {
      reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`)
    })
    request.raw.on('close', unsubscribe)
  })

  app.post('/workspaces/:workspaceId/presence/report', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = PresenceReportSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    presenceStore.setEntry(workspaceId, parsed.data.deviceId, {
      profileId: parsed.data.profileId,
      lastSeenAt: Date.now(),
    })
    return reply.status(204).send()
  })

  // Master-Token heartbeat (#32): the current master beats every 5 s, readers treat it as gone
  // after 15 s. Broadcast on the presence stream above instead of a stream of its own.
  app.post('/workspaces/:workspaceId/master-heartbeat', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = MasterHeartbeatReportSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    presenceStore.setMasterHeartbeat(workspaceId, parsed.data.deviceId)
    return reply.status(204).send()
  })

  // Stage-Messenger (#26): a flash message for every tablet of the band, pushed on the presence
  // stream like the Ready Check. In memory only - a message is only meaningful for seconds.
  app.post('/workspaces/:workspaceId/flash', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = FlashReportSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    // Unlike the presence reports, a flash *pushes* text onto every tablet of the band - so only a
    // device signed in to this band may send one (its own CouchDB login, as Basic auth).
    const login = basicAuthCredentials(request.headers.authorization)
    if (!login || !login.username.startsWith(`${workspaceDbName(workspaceId)}-`) || (await verifyUser(couch, login.username, login.password)) === null) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Flash message refused - not signed in to this band')
      return reply.status(401).send({ status: 'error', message: 'Only a device of this band can send flash messages' })
    }
    const flash = presenceStore.setFlash(workspaceId, parsed.data.text, parsed.data.from, parsed.data.to)
    app.log.info({ workspaceId, flashId: flash.id, from: flash.from, to: flash.to ?? 'all', remoteAddress: request.ip }, 'Flash message sent')
    return reply.status(201).send(flash)
  })

  // Fast lane for the master's show-state changes (#468): Play, Pause, Stop, Weiter reach every
  // device at once instead of through database replication (up to 1 s from the Fire). The database
  // write still happens on the master; devices keep whichever copy is newer (stateIssuedAt).
  app.get('/workspaces/:workspaceId/show-state/stream', (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    beginSseStream(request, reply)
    const unsubscribe = showStatePushHub.subscribe(workspaceId, (push) => {
      reply.raw.write(`data: ${JSON.stringify(push)}\n\n`)
    })
    request.raw.on('close', unsubscribe)
  })

  app.post('/workspaces/:workspaceId/show-state/push', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = ShowStatePushSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    // Only a device of this band may change what every tablet plays - its own CouchDB login, as for
    // flash messages. Checked logins are remembered for a while: this is on the Play path.
    if (!(await isBandDevice(workspaceId, request.headers.authorization))) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Show-state push refused - not signed in to this band')
      return reply.status(401).send({ status: 'error', message: 'Only a device of this band can push the show state' })
    }
    const devices = showStatePushHub.broadcast(workspaceId, parsed.data)
    app.log.info({ workspaceId, deviceId: parsed.data.deviceId, issuedAt: parsed.data.issuedAt, receivedMs: Date.now() - parsed.data.issuedAt, keys: Object.keys(parsed.data.patch), devices }, 'Show state pushed')
    return reply.status(204).send()
  })

  // Each device reports when a change reached it - the measurement behind PLAY_LEAD_MS.
  app.post('/workspaces/:workspaceId/show-state/ack', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = ShowStatePushAckSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    const { deviceId, deviceName, issuedAt, receivedAt, via } = parsed.data
    app.log.info({ workspaceId, deviceId, deviceName, issuedAt, via, delayMs: Math.round(receivedAt - issuedAt), remoteAddress: request.ip }, 'Show state reached device')
    return reply.status(204).send()
  })

  // Ready Check answers (#60): a tablet says "this profile is ready" for the check the Master opened
  // (ShowState.readyCheckId). In memory and pushed on the presence stream, like the master heartbeat.
  app.post('/workspaces/:workspaceId/ready-check/report', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = ReadyReportSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    presenceStore.setReady(workspaceId, parsed.data.checkId, parsed.data.profileId)
    return reply.status(204).send()
  })

  // Device Ledger's live diagnostic data (DeviceLedgerView.tsx, Marco's explicit request) -
  // deliberately a plain one-shot GET, NOT an SSE push like plugin-health/presence above, and
  // polled client-side instead (DeviceLedgerView.tsx's own effect) - found live, 2026-09-08:
  // this app already holds ~5 other long-lived SSE/EventSource connections open per tab for the
  // whole session (presence, trigger-stream, discovery, plugin-health x2) against a plain
  // HTTPS/1.1 dev server (no HTTP/2 negotiated), already sitting at/near Chrome's
  // 6-connections-per-origin cap *before* this route existed. A 6th persistent stream here
  // starved one-off requests (report POSTs, and - worse - the admin revoke POST, exactly while
  // someone had this screen open to use it) of a connection entirely. A poll holds nothing
  // open between requests, so it doesn't compete for that same tight budget. No auth, same
  // reasoning as presence's routes.
  app.get('/workspaces/:workspaceId/device-info', (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    return reply.status(200).send(deviceInfoStore.getSnapshot(workspaceId))
  })

  app.post('/workspaces/:workspaceId/device-info/report', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = DeviceInfoReportSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    deviceInfoStore.setEntry(workspaceId, parsed.data.deviceId, {
      ip: request.ip,
      os: parsed.data.os,
      environment: parsed.data.environment,
      syncStatus: parsed.data.syncStatus,
      lastSeenAt: Date.now(),
      // Preserved across a report (which doesn't know either) rather than reset - pingLoop.ts
      // refreshes both independently on its own cadence.
      networkReachable: deviceInfoStore.getSnapshot(workspaceId).devices[parsed.data.deviceId]?.networkReachable ?? null,
      hostname: deviceInfoStore.getSnapshot(workspaceId).devices[parsed.data.deviceId]?.hostname ?? null,
    })
    return reply.status(204).send()
  })

  // Device Ledger's admin-only "kick" (Marco, explicit request, deliberately a *soft* kick -
  // see device.ts's `revoked` doc comment). Same verifyAdmin + zod-parse + putDocWithRetry-merge
  // template as every other admin-gated write in this file (e.g. the member-admin route above).
  app.post('/workspaces/:workspaceId/devices/:deviceId/revoke', async (request, reply) => {
    const { workspaceId, deviceId } = request.params as { workspaceId: string; deviceId: string }
    const parsed = RevokeDeviceRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    const docId = `devices:${deviceId}`
    const existing = await getDoc<Device & CouchDoc>(couch, workspaceDbName(workspaceId), docId)
    if (!existing) {
      return reply.status(404).send({ status: 'error', message: 'Unknown device' })
    }
    await putDocWithRetry<Device & CouchDoc>(couch, workspaceDbName(workspaceId), docId, (current) => ({
      ...(current ?? existing),
      revoked: parsed.data.revoked,
      _id: docId,
      _rev: current?._rev ?? existing._rev,
    }))
    return reply.status(204).send()
  })

  // Device Ledger cleanup (Marco, 2026-10-07): removes an entry - old and duplicate devices
  // flooded the Geräte tab. Unlike revoke this is no block: the device registers again on its
  // next start. Refused (409) for a blocked device - the block lives on this very doc, deleting
  // it would lift the block - and for a device a hardware device runs on (`executionTarget`):
  // that must first move to another device in the Hardware tab (Marco's call: never remove a
  // device in use).
  app.post('/workspaces/:workspaceId/devices/:deviceId/forget', async (request, reply) => {
    const { workspaceId, deviceId } = request.params as { workspaceId: string; deviceId: string }
    const parsed = ForgetDeviceRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      request.log.warn({ workspaceId, deviceId }, 'device forget refused: not this band\'s admin')
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }
    const db = workspaceDbName(workspaceId)
    const docId = `devices:${deviceId}`
    const existing = await getDoc<Device & CouchDoc>(couch, db, docId)
    if (!existing) {
      request.log.info({ workspaceId, deviceId }, 'device forget: unknown device')
      return reply.status(404).send({ status: 'error', message: 'Unknown device' })
    }
    if (existing.revoked) {
      request.log.info({ workspaceId, deviceId }, 'device forget refused: blocked')
      return reply.status(409).send({ status: 'error', message: 'blocked' })
    }
    const hardware = await allDocs<CouchDoc & { name?: string; executionTarget?: string | null }>(couch, db, {
      startkey: 'logical-devices:',
      endkey: 'logical-devices:\ufff0',
    })
    const usedBy = hardware.filter((doc) => doc.executionTarget === deviceId).map((doc) => doc.name ?? doc._id)
    if (usedBy.length > 0) {
      request.log.info({ workspaceId, deviceId, usedBy }, 'device forget refused: in use by hardware')
      return reply.status(409).send({ status: 'error', message: 'in-use', usedBy })
    }
    // Checked and deleted against the same revision; a write in between (the device's own
    // lastSeenAt, a rename, a block) is a conflict - read again and check again instead of
    // answering 204 for a delete that never happened (#426 review).
    const result = await deleteDocUnless<Device & CouchDoc, 'blocked'>(couch, db, docId, (existing) => (existing.revoked ? 'blocked' : null))
    if (result === 'missing') {
      request.log.info({ workspaceId, deviceId }, 'device forget: unknown device')
      return reply.status(404).send({ status: 'error', message: 'Unknown device' })
    }
    if (result === 'blocked') {
      request.log.info({ workspaceId, deviceId }, 'device forget refused: blocked')
      return reply.status(409).send({ status: 'error', message: 'blocked' })
    }
    request.log.info({ workspaceId, deviceId }, 'device removed from ledger')
    return reply.status(204).send()
  })

  // #10's HardwareSetup routing: a lighting/mixer cue fired from one tablet, relayed to
  // whichever tablet the active HardwareSetup binds that capability to, since - unlike
  // audio's continuous synced playbackStatus, which every tablet already watches on its own -
  // a cue is a one-shot event with nothing to piggyback on. Same SSE push pattern as
  // plugin-health/presence above, just keyed by (workspaceId, deviceId) via deviceRelay.ts
  // instead of workspaceId alone, since this must reach exactly the one claimed device.
  app.get('/workspaces/:workspaceId/devices/:deviceId/trigger-stream', (request, reply) => {
    const { workspaceId, deviceId } = request.params as { workspaceId: string; deviceId: string }
    beginSseStream(request, reply)

    const unsubscribe = deviceRelay.subscribe(workspaceId, deviceId, (trigger) => {
      reply.raw.write(`data: ${JSON.stringify(trigger)}\n\n`)
    })
    request.raw.on('close', unsubscribe)
  })

  app.post('/workspaces/:workspaceId/devices/:deviceId/trigger', async (request, reply) => {
    const { workspaceId, deviceId } = request.params as { workspaceId: string; deviceId: string }
    const parsed = DeviceTriggerSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    const delivered = deviceRelay.relay(workspaceId, deviceId, parsed.data)
    if (!delivered) {
      return reply.status(200).send({ status: 'error', message: 'Zielgerät nicht verbunden' })
    }
    return { status: 'ok' }
  })

  // Discovery Mode: bandwide, admin-initiated hardware detection (discoverySessionStore.ts) -
  // same SSE broadcast pattern as presence/plugin-health above, keyed by workspaceId. Every
  // connected tablet (and core-backend's own future native-MIDI watcher) reports what it sees
  // and gets the same live session snapshot back; the store owns all resolution logic.
  app.get('/workspaces/:workspaceId/discovery/stream', (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    beginSseStream(request, reply)

    const unsubscribe = discoverySessionStore.subscribe(workspaceId, (snapshot) => {
      reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`)
    })
    request.raw.on('close', unsubscribe)
  })

  app.post('/workspaces/:workspaceId/discovery/start', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = DiscoveryStartRequestSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    await discoverySessionStore.start(couch, workspaceId, parsed.data.startedBy)
    return { status: 'ok' }
  })

  app.post('/workspaces/:workspaceId/discovery/stop', async (request) => {
    const { workspaceId } = request.params as { workspaceId: string }
    discoverySessionStore.stop(workspaceId)
    return { status: 'ok' }
  })

  app.post('/workspaces/:workspaceId/discovery/candidates', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = DiscoveryReportCandidateRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    discoverySessionStore.reportCandidate(workspaceId, parsed.data.reporterId, parsed.data.detected)
    return { status: 'ok' }
  })

  app.post('/workspaces/:workspaceId/discovery/triggered', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = DiscoveryTriggeredRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    discoverySessionStore.reportTriggered(workspaceId, parsed.data.reporterId, parsed.data.hardwareKey)
    return { status: 'ok' }
  })

  app.post('/workspaces/:workspaceId/discovery/assign', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = DiscoveryAssignRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    discoverySessionStore.assign(workspaceId, parsed.data.reporterId, parsed.data.hardwareKey, parsed.data.logicalDeviceId)
    return { status: 'ok' }
  })

  const registry = new PluginRegistry()

  const pluginLog = {
    info: (msg: string, meta?: Record<string, unknown>) => app.log.info(meta ?? {}, msg),
    error: (msg: string, meta?: Record<string, unknown>) => app.log.error(meta ?? {}, msg),
  }

  // Owns which single workspace's hardware (plugin sync, Discovery Mode's MIDI watcher) this
  // box currently serves - lives here, not in main(), so the activate-hardware route below can
  // reach the same instance main() activates at boot. deactivate() on close covers both a real
  // shutdown and every test's afterEach(() => app.close()).
  const workspaceHardware = createWorkspaceHardwareController({ couch, registry, log: pluginLog })
  app.addHook('onClose', async () => workspaceHardware.deactivate())

  // Temporary lockout for guessing an admin PIN (only 10,000 possibilities) - shared by every route
  // that checks one, so verify-admin-pin and activate-hardware can't each be used to get a fresh
  // set of guesses. Keyed per workspace + profile.
  const pinThrottle = createPinThrottle()

  // Admin logins on the admin routes below: the anchor account's password is the admin's 4-digit
  // PIN, so it gets the same lockout per account. And the account must belong to *this* band -
  // the CouchDB role `admin` alone is shared by the admins of every band on the server.
  const adminLoginThrottle = createPinThrottle()

  async function isWorkspaceAdmin(request: FastifyRequest, workspaceId: string, username: string, password: string): Promise<boolean> {
    if (!username.startsWith(`${workspaceDbName(workspaceId)}-`)) {
      app.log.warn({ workspaceId, username, remoteAddress: request.ip }, 'Admin login for another band refused')
      return false
    }
    if (adminLoginThrottle.lockedForSeconds(username) > 0) return false
    if (await verifyAdmin(couch, username, password)) {
      adminLoginThrottle.recordSuccess(username)
      return true
    }
    if (adminLoginThrottle.recordFailure(username)) {
      app.log.warn({ workspaceId, username, remoteAddress: request.ip }, 'Too many wrong admin logins - locked out temporarily')
    }
    return false
  }

  type PinCheck = { ok: true } | { ok: false; retryAfterSeconds?: number }
  async function checkAdminPin(request: FastifyRequest, workspaceId: string, profileId: string, pin: string): Promise<PinCheck> {
    const key = `${workspaceId}:${profileId}`
    const retryAfterSeconds = pinThrottle.lockedForSeconds(key)
    if (retryAfterSeconds > 0) return { ok: false, retryAfterSeconds }

    if (await verifyAdminPin(couch, workspaceId, profileId, pin)) {
      pinThrottle.recordSuccess(key)
      return { ok: true }
    }
    if (pinThrottle.recordFailure(key)) {
      app.log.warn({ workspaceId, profileId, remoteAddress: request.ip }, 'Too many wrong admin PINs - locked out temporarily')
    }
    return { ok: false }
  }

  /** 429 with how long to wait when locked, otherwise the plain 403 for a wrong proof. */
  function rejectPin(reply: FastifyReply, check: { ok: false; retryAfterSeconds?: number }, forbiddenMessage: string) {
    if (check.retryAfterSeconds) {
      return reply
        .status(429)
        .header('Retry-After', String(check.retryAfterSeconds))
        .send({ status: 'error', message: 'Too many wrong PINs - try again later', retryAfterSeconds: check.retryAfterSeconds })
    }
    return reply.status(403).send({ status: 'error', message: forbiddenMessage })
  }

  app.get('/plugins', async () => registry.list())

  // #101's Stage-Server mirror: whatever pluginSync.ts's downloadMissingBundles already
  // cached to disk, served back out to any tablet on the LAN - same @fastify/static-style
  // static-file-from-disk shape the app's own build output uses (see docs/03), just for one
  // plugin bundle at a time instead of the whole PWA.
  app.get('/plugins/:id/client.js', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!isSafePluginId(id)) {
      return reply.status(400).send({ status: 'error', message: 'Invalid plugin id' })
    }
    const bundle = await readPluginBundle(id)
    if (bundle === null) {
      return reply.status(404).send({ status: 'error', message: 'No client bundle cached for this plugin' })
    }
    return reply.type('application/javascript').send(bundle)
  })

  app.post('/plugins/:name/trigger', async (request, reply) => {
    const { name } = request.params as { name: string }
    const parsed = ShowControlEventSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    // scheduledAt is a Gateway-only concern (see the schema doc comment) - the plugin itself
    // only ever sees type/payload, same shape as before #31.
    const { scheduledAt, ...event } = parsed.data
    if (scheduledAt !== undefined) {
      const delayMs = scheduledAt - Date.now()
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    const result = await registry.trigger(name, event)
    if (result === null) {
      return reply.status(404).send({ status: 'error', message: `Unknown plugin: ${name}` })
    }
    return result
  })

  const lookupRegistry = new LookupRegistry()

  app.get('/lookup/:provider/search', async (request, reply) => {
    const { provider } = request.params as { provider: string }
    const { q } = request.query as { q?: string }
    if (!q) {
      return reply.status(400).send({ status: 'error', message: 'Missing query parameter q' })
    }

    try {
      const results = await lookupRegistry.search(provider, q)
      if (results === null) {
        return reply.status(404).send({ status: 'error', message: `Unknown provider: ${provider}` })
      }
      return results
    } catch (err) {
      app.log.error({ err, provider, cause: (err as { cause?: unknown }).cause }, 'Lookup search failed')
      return reply.status(502).send(lookupErrorBody(err))
    }
  })

  // resultId travels as a query param, not a path param: an opaque id can embed a full source
  // URL (see ultimateGuitarPlugin.ts), and Fastify's router rejects any single path param over
  // 100 characters by default - a limit a real URL clears easily. Query strings have no such
  // per-segment ceiling.
  app.get('/lookup/:provider/detail', async (request, reply) => {
    const { provider } = request.params as { provider: string }
    const { resultId } = request.query as { resultId?: string }
    if (!resultId) {
      return reply.status(400).send({ status: 'error', message: 'Missing query parameter resultId' })
    }

    try {
      const detail = await lookupRegistry.fetchDetail(provider, resultId)
      if (detail === null) {
        return reply.status(404).send({ status: 'error', message: `Unknown provider: ${provider}` })
      }
      return detail
    } catch (err) {
      app.log.error({ err, provider, cause: (err as { cause?: unknown }).cause }, 'Lookup detail failed')
      return reply.status(502).send(lookupErrorBody(err))
    }
  })

  // Provisions a brand-new workspace: its database, `_security` doc, roster validation doc, and
  // the founding device's own personal CouchDB account (see per-person-accounts follow-up -
  // every roster member gets their own account, the founder is just the first one, auto-admin).
  // Who may found a band (#364, Marco 2026-10-05): the first band on a fresh server anyone; every
  // further one only an admin of a band on this server (or the server machine itself).
  const adminProofThrottle = createPinThrottle()

  /** An admin login as proof for founding (any band's admin) - locked after 5 wrong tries per
   * account like the PIN routes, since an admin's anchor password is their 4-digit PIN. */
  async function isAnyBandAdmin(request: FastifyRequest, username: string, password: string): Promise<boolean> {
    const key = `admin:${username}`
    if (adminProofThrottle.lockedForSeconds(key) > 0) return false
    if (await verifyAdmin(couch, username, password)) {
      adminProofThrottle.recordSuccess(key)
      return true
    }
    if (adminProofThrottle.recordFailure(key)) app.log.warn({ username, remoteAddress: request.ip }, 'Too many wrong admin logins - locked out temporarily')
    return false
  }

  app.post('/workspaces', async (request, reply) => {
    const parsed = WorkspaceProvisionRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    const { workspaceId, adminUsername, adminPassword } = parsed.data

    // A deleted band comes back only through the documented CouchDB recovery (docs/03 §0b) -
    // this route handed its admin account to anyone before (#364, 2026-10-04).
    if (readDeletedWorkspaces().includes(workspaceId)) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Refused to provision a deleted band again')
      return reply.status(409).send({ status: 'error', code: 'deleted', message: 'This band was deleted - restore it via docs/03 §0b' })
    }

    // Accounts are tied to their band by name (`stageboard-<band>-<profile>`), so no band id may
    // extend another one - band "x-y" would otherwise own names that look like band "x"'s.
    const bandDbs = (await listDbs(couch)).filter((db) => db.startsWith('stageboard-'))
    const newDb = workspaceDbName(workspaceId)
    if (bandDbs.some((db) => db !== newDb && (newDb.startsWith(`${db}-`) || db.startsWith(`${newDb}-`)))) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Refused a band id that extends another band id')
      return reply.status(400).send({ status: 'error', message: 'Invalid band id' })
    }

    let proof: 'first-band' | 'server' | 'admin' | null = null
    if (isLoopback(request.ip)) proof = 'server'
    else if (bandDbs.length === 0) proof = 'first-band'
    else if (adminUsername && adminPassword && (await isAnyBandAdmin(request, adminUsername, adminPassword))) proof = 'admin'
    if (!proof) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Band provisioning refused - no proof')
      return reply.status(403).send({ status: 'error', code: 'admin-required', message: 'Only an admin of a band on this server can found another band' })
    }

    try {
      const credentials = await provisionWorkspace(couch, workspaceId, parsed.data.founderId, parsed.data.workspaceName)
      app.log.info({ workspaceId, proof, remoteAddress: request.ip }, 'Band provisioned')
      return reply.status(201).send(credentials)
    } catch (err) {
      if (err instanceof WorkspaceAlreadyProvisionedError) {
        return reply.status(409).send({ status: 'error', message: err.message })
      }
      app.log.error(err)
      return reply.status(502).send({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // Provisions one additional roster member's personal CouchDB account (see
  // per-person-accounts follow-up) - the roster doc itself is a separate, ordinary write the
  // calling (already-admin) device does itself right after this returns, not something
  // core-backend does. `password` is the admin's optional PIN choice; omitted means a long
  // random one is generated here and returned (it can never be read back out again later).
  app.post('/workspaces/:workspaceId/members', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = CreateMemberRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    const password = parsed.data.password ?? generateMemberPassword()
    const credentials = await provisionMember(couch, workspaceId, parsed.data.profileId, password, parsed.data.isAdmin ?? false)
    return reply.status(201).send(credentials)
  })

  // Grants or revokes admin for one already-provisioned member - rejects a revoke that would
  // leave zero admins (see countOtherAdmins above): unlike before, there's no shared fallback
  // admin account to fall back on if the last one is removed, so this has to be enforced here,
  // not just disabled in the UI.
  app.post('/workspaces/:workspaceId/members/:profileId/admin', async (request, reply) => {
    const { workspaceId, profileId } = request.params as { workspaceId: string; profileId: string }
    const parsed = SetMemberAdminRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    if (!parsed.data.isAdmin && (await countOtherAdmins(couch, workspaceId, profileId)) === 0) {
      return reply.status(400).send({ status: 'error', message: 'At least one admin must remain' })
    }
    // No admin takes away their own admin rights (Marco, 2026-10-07) - only another admin can.
    // The caller's profile is in its username: `<band db>-<profileId>` or `…-<profileId>~<deviceId>`.
    const callerProfileId = parsed.data.adminUsername.slice(workspaceDbName(workspaceId).length + 1).split('~')[0]
    if (!parsed.data.isAdmin && callerProfileId === profileId) {
      return reply.status(400).send({ status: 'error', message: 'An admin cannot revoke their own admin rights' })
    }

    await setMemberAdmin(couch, workspaceId, profileId, parsed.data.isAdmin)
    return reply.status(204).send()
  })

  // Deprovisions one member's personal CouchDB account - same last-admin rejection as the
  // admin-toggle route above (removing the sole remaining admin is just as terminal as
  // demoting them). The roster doc itself is removed separately by the calling device, as
  // always.
  app.delete('/workspaces/:workspaceId/members/:profileId', async (request, reply) => {
    const { workspaceId, profileId } = request.params as { workspaceId: string; profileId: string }
    const parsed = RemoveMemberRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    // Only actually blocks removing the sole remaining *admin* - deleting a plain member never
    // changes the admin count, so this only rejects when the target itself is that one admin.
    // No admin removes their own profile - only another admin can (Marco, 2026-10-08), like
    // taking away one's own admin rights below. Checked before any CouchDB read.
    if (parsed.data.adminUsername.slice(workspaceDbName(workspaceId).length + 1).split('~')[0] === profileId) {
      return reply.status(400).send({ status: 'error', message: 'An admin cannot remove their own profile' })
    }

    if ((await countOtherAdmins(couch, workspaceId, profileId)) === 0) {
      return reply.status(400).send({ status: 'error', message: 'At least one admin must remain' })
    }

    await deprovisionMember(couch, workspaceId, profileId)
    return reply.status(204).send()
  })

  // Resets another admin's PIN to a fresh, human-relayable 4-digit one (2026-08-31,
  // BandManagementView.tsx's "Passwort zurücksetzen" - the "another admin's session is
  // available" escape hatch for a locked-out admin). 2026-09-02 second follow-up: only
  // meaningful for an admin target now - a non-admin has no PIN at all
  // (`RosterMemberSchema`'s doc comment in shared-types), so this rejects a non-admin target
  // outright rather than silently doing nothing useful. No last-admin check needed - unlike
  // remove/demote, a PIN reset can't reduce the admin count.
  app.post('/workspaces/:workspaceId/members/:profileId/reset-password', async (request, reply) => {
    const { workspaceId, profileId } = request.params as { workspaceId: string; profileId: string }
    const parsed = ResetMemberPasswordRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    const profile = await getDoc<CouchDoc & { stageRoles?: string[] }>(couch, workspaceDbName(workspaceId), `${PROFILE_ID_PREFIX}${profileId}`)
    if (!profile) {
      return reply.status(404).send({ status: 'error', message: 'Unknown roster member' })
    }
    if (!(profile.stageRoles ?? []).includes('admin')) {
      return reply.status(400).send({ status: 'error', message: 'Only admin accounts have a PIN to reset' })
    }

    const credentials = await resetAdminPin(couch, workspaceId, profileId)
    return reply.status(200).send(credentials)
  })

  // 2026-09-02 second follow-up, at Marco's explicit request: an admin self-assigning or
  // changing *their own* 4-digit PIN ("Bei Admins ... [ein] 4 stelliger Code, der selbst
  // vergeben werden kann") - strictly self-service, checked by requiring `callerUsername` to be
  // the *exact* account being changed, not just any admin of this workspace (that's what
  // "Passwort zurücksetzen" above is for instead, when it's someone *else's* PIN).
  //
  // Found live, 2026-09-10: this predates the per-device-account migration (`resolveOutcome`'s
  // doc comment) and was never updated for it - `callerUsername` is always this device's own
  // `deviceUsername` now (`stageboard-<workspaceId>-<profileId>~<deviceId>`), never the bare
  // anchor `memberUsername` this route compared it against, so the exact-match check 403'd
  // every admin unconditionally. Now accepts either shape, as long as it's *this* profile's own
  // account (some other device, or a different profile's device, still correctly 403s).
  app.post('/workspaces/:workspaceId/members/:profileId/set-pin', async (request, reply) => {
    const { workspaceId, profileId } = request.params as { workspaceId: string; profileId: string }
    const parsed = SetOwnPinRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    const targetUsername = memberUsername(workspaceId, profileId)
    const isOwnAccount = parsed.data.callerUsername === targetUsername || parsed.data.callerUsername.startsWith(`${targetUsername}~`)
    if (!isOwnAccount) {
      return reply.status(403).send({ status: 'error', message: 'Can only set your own PIN' })
    }
    const caller = await verifyUser(couch, parsed.data.callerUsername, parsed.data.callerPassword)
    if (!caller || !caller.roles.includes('admin')) {
      return reply.status(403).send({ status: 'error', message: 'Invalid credentials or not an admin account' })
    }

    await setMemberPassword(couch, workspaceId, profileId, parsed.data.newPin)
    // The PIN itself lives on the anchor account just updated above, never on the calling
    // device's own account - reissuing this device's own credentials here (rather than handing
    // back the anchor's) keeps every device's real sync login private to itself, same as every
    // other join/activate path (see this schema's own doc comment, shared-types/workspace.ts).
    const credentials = await provisionDevice(couch, workspaceId, profileId, parsed.data.deviceId, true)
    return reply.status(200).send({ ...credentials, isAdmin: true })
  })

  // Irreversibly destroys a workspace - same admin-verification pattern as the routes above.
  // Deletes the CouchDB database and every member's personal account
  // (workspaceProvisioning.ts's deprovisionWorkspace); does not, and can't, notify any other
  // device that already joined.
  app.delete('/workspaces/:workspaceId', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = WorkspaceDeleteRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    await deprovisionWorkspace(couch, workspaceId)
    return reply.status(204).send()
  })

  // Public, no auth (2026-09-01 WiFi-style redesign, at Marco's request after being locked out
  // of every device at once) - every band this Stage-Server hosts, discoverable with no code at
  // all, the same way WiFi network names are visible before you enter a password. See
  // workspaceProvisioning.ts's `listWorkspaces` for the lazy-backfill behavior on a workspace
  // that predates this redesign.
  app.get('/workspaces', async (_request, reply) => {
    const workspaces = await listWorkspaces(couch)
    return reply.status(200).send(workspaces)
  })

  // Public, no auth - the WiFi "enter the network's password" step, scoped to one workspace
  // picked from GET /workspaces above. `getOrCreateAccessCode` lazily creates a workspace's
  // standing code on first use if it predates this redesign - this route alone is what made
  // Marco's own locked-out workspace start working again, no separate migration needed. Hands
  // back names/roles only, never credentials - the joining device still has to pick who it is
  // (POST /workspaces/:workspaceId/join/:profileId below) before it gets anything real.
  app.post('/workspaces/:workspaceId/roster', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = RosterRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    const accessCode = await getOrCreateAccessCode(couch, workspaceId, workspaceId)
    if (parsed.data.code !== accessCode.code) {
      return reply.status(403).send({ status: 'error', message: 'Wrong code' })
    }

    const members = await readRoster(couch, workspaceId)
    return reply.status(200).send({ workspaceId, workspaceName: accessCode.name, members })
  })

  // Public, no auth - the second half of the self-service join (2026-09-01 redesign). Requires
  // the workspace's current standing code, then defers to `resolveOutcome` above for the actual
  // per-role decision - including passing the code's own last 4 digits along as the universal
  // admin recovery suffix (2026-09-02 second follow-up), since a device reaching this route has
  // necessarily already typed the full code.
  app.post('/workspaces/:workspaceId/join/:profileId', async (request, reply) => {
    const { workspaceId, profileId } = request.params as { workspaceId: string; profileId: string }
    const parsed = JoinAsMemberRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    const accessCode = await getOrCreateAccessCode(couch, workspaceId, workspaceId)
    if (parsed.data.code !== accessCode.code) {
      return reply.status(403).send({ status: 'error', message: 'Wrong code' })
    }

    const result = await resolveOutcome(couch, workspaceId, profileId, parsed.data.deviceId, parsed.data.password, accessCode.code.slice(-4))
    if (!result.ok) {
      return reply.status(result.code).send({ status: 'error', message: result.message })
    }
    return reply.status(result.code).send(result.body)
  })

  // 2026-09-02 follow-up, at Marco's explicit request: lets an already-connected device become
  // a *different* roster member within the *same* workspace it's already joined - consolidates
  // switching bands/profiles into BandManagementView.tsx's "Band" tab, replacing the removed
  // `ProfileSwitcher.tsx` (which let any device silently display as anyone, no credential check
  // at all). The proof of trust here is the caller's own current credentials for *this*
  // workspace (checked by username prefix, so a credential from a different workspace can't be
  // reused) - the same trust level as knowing the workspace's own access code, since both really
  // just mean "already inside this band". Everything past that is identical to the join route
  // above (`resolveOutcome`), including fetching the access code purely to derive the universal
  // admin recovery suffix from it (the caller here never had to type the code itself at all).
  app.post('/workspaces/:workspaceId/members/:profileId/activate', async (request, reply) => {
    const { workspaceId, profileId } = request.params as { workspaceId: string; profileId: string }
    const parsed = ActivateProfileRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!parsed.data.callerUsername.startsWith(`${workspaceDbName(workspaceId)}-`)) {
      return reply.status(403).send({ status: 'error', message: 'Caller is not a member of this workspace' })
    }
    const caller = await verifyUser(couch, parsed.data.callerUsername, parsed.data.callerPassword)
    if (!caller) {
      return reply.status(403).send({ status: 'error', message: 'Invalid caller credentials' })
    }

    // Re-picking this exact device's own already-active profile (BandManagementView.tsx's
    // profile list has no guard against tapping the current one) - found live, 2026-09-09: this
    // used to fall through to resolveOutcome/provisionDevice below, which unconditionally mints
    // a *new* random password even though the one just verified two lines up already works.
    // CouchDB never returns a plaintext password once hashed, so "leave it unchanged" has to be
    // handled here, before any rotation happens, not by reading anything back afterward. Any
    // other caller (a different device, or a different target profile/deviceId) still goes
    // through the normal path below and gets a real, freshly-provisioned account as before.
    if (parsed.data.callerUsername === deviceUsername(workspaceId, profileId, parsed.data.deviceId)) {
      return reply.status(200).send({
        username: parsed.data.callerUsername,
        password: parsed.data.callerPassword,
        isAdmin: caller.roles.includes('admin'),
      })
    }

    const accessCode = await getOrCreateAccessCode(couch, workspaceId, workspaceId)
    const result = await resolveOutcome(couch, workspaceId, profileId, parsed.data.deviceId, parsed.data.password, accessCode.code.slice(-4))
    if (!result.ok) {
      return reply.status(result.code).send({ status: 'error', message: result.message })
    }
    return reply.status(result.code).send(result.body)
  })

  // Admin-only: fetches a workspace's *current* standing code, to display/re-display (e.g.
  // BandManagementView.tsx's "Einladen") without changing it - lazily creates one first if
  // this workspace predates the 2026-09-01 redesign (same backfill `POST /workspaces/:id/roster`
  // and `.../join/:profileId` already do), so a pre-existing workspace's admin can view a real,
  // working code the very first time they open "Einladen" post-upgrade.
  app.post('/workspaces/:workspaceId/access-code', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = GetAccessCodeRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    const { code } = await getOrCreateAccessCode(couch, workspaceId, workspaceId)
    return reply.status(200).send({ code })
  })

  // Admin-only: rotates a workspace's standing access code (e.g. "the code leaked", or routine
  // post-tour cleanup). Immediately invalidates the old code for anyone who only knew that one.
  app.post('/workspaces/:workspaceId/access-code/rotate', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = RotateAccessCodeRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    const code = await rotateAccessCode(couch, workspaceId)
    return reply.status(200).send({ code })
  })

  // Admin-only (#58): renames a workspace. Writes straight onto the `workspace:access` doc's
  // `name` field, keeping its `code` - that doc already replicates to every joined device via
  // the ordinary workspace-db sync, so this is the only write needed for the new name to reach
  // everyone, no separate notification/polling required.
  app.post('/workspaces/:workspaceId/name', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = RenameWorkspaceRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    await renameWorkspace(couch, workspaceId, parsed.data.name)
    return reply.status(200).send({ status: 'ok' })
  })

  // Who holds the Master-Token (#85): admin-only, stored with the band name.
  app.post('/workspaces/:workspaceId/master-mode', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = SetMasterModeRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    // Band-scoped and locked out after wrong tries like every other admin route - a bare
    // verifyAdmin() would take any band's admin and allow unlimited PIN guesses.
    if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: "Not this workspace's admin" })
    }
    try {
      await setMasterMode(couch, workspaceId, parsed.data.masterMode)
    } catch (err) {
      app.log.error({ err, workspaceId, masterMode: parsed.data.masterMode }, 'Setting the master mode failed')
      return reply.status(500).send({ status: 'error', message: 'Could not save the master mode' })
    }
    app.log.info({ workspaceId, masterMode: parsed.data.masterMode }, 'Master mode set')
    return reply.status(200).send({ status: 'ok' })
  })

  // Makes this box's hardware (plugin sync, Discovery Mode's MIDI watcher) serve `workspaceId`
  // instead of whichever workspace was previously active - the runtime replacement for having
  // to kill the process and restart it with a different STAGEBOARD_WORKSPACE env var, for the
  // real case of one Stage-Server serving two of Marco's own bands on different days, never at
  // the same time (see workspaceHardwareController.ts).
  app.post('/workspaces/:workspaceId/activate-hardware', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = ActivateWorkspaceHardwareRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    // Opening proof: an admin of the workspace being activated. Checked against *that*
    // workspace's own roster and PIN (verifyAdminPin), so it can't be satisfied by an admin of
    // some other workspace - unlike a bare verifyAdmin(), the flat 'admin' CouchDB role is never
    // what decides this.
    const { opening, closing } = parsed.data
    const openingCheck = await checkAdminPin(request, workspaceId, opening.profileId, opening.pin)
    if (!openingCheck.ok) return rejectPin(reply, openingCheck, 'Not this workspace\'s admin')

    // Closing proof: only required when some *other* workspace is currently active on this
    // box - proves the caller is allowed to interrupt whatever's actually live right now, not
    // just that they're an admin of wherever they're switching to. Without this, anyone who
    // merely knows the *opening* band's PIN could silently kill a different band's live show,
    // with no relationship to it at all.
    const currentlyActive = workspaceHardware.getActiveWorkspaceId()
    if (currentlyActive && currentlyActive !== workspaceId) {
      if (!closing) {
        return reply.status(400).send({
          status: 'error',
          message: `Admin proof for the currently active workspace (${currentlyActive}) is required to switch away from it`,
        })
      }
      const closingCheck = await checkAdminPin(request, currentlyActive, closing.profileId, closing.pin)
      if (!closingCheck.ok) return rejectPin(reply, closingCheck, 'Not the currently active workspace\'s admin')
    }

    await workspaceHardware.activate(workspaceId)
    return reply.status(200).send({ status: 'ok' })
  })

  // Stateless "is this roster admin + PIN valid for this workspace" - lets the hardware-switch
  // wizard reject a wrong PIN at the step it was typed, rather than only when the switch is
  // finally committed (activate-hardware re-verifies both proofs itself; nothing here is a
  // token). No side effects beyond the shared PIN lockout (pinThrottle).
  app.post('/workspaces/:workspaceId/verify-admin-pin', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = VerifyAdminPinRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    const check = await checkAdminPin(request, workspaceId, parsed.data.profileId, parsed.data.pin)
    if (!check.ok) return rejectPin(reply, check, 'Wrong admin or PIN')
    return reply.status(200).send({ status: 'ok' })
  })

  // Which workspace (if any) this specific box's hardware currently serves - not scoped under
  // /workspaces/:workspaceId since it describes the server, not a workspace, and needs no auth
  // for the same reason /server-info needs none: not new information beyond what's already
  // observable on the LAN.
  // The Stage-Server's backups (#363, Marco 2026-10-08): targets chosen in the app (System →
  // Backup), run by the server itself - backup.ts. Admin of the band this server serves.
  const backups: BackupService =
    options.backupService ??
    createBackupService(
      realBackupDeps(async () => {
        const workspaceId = workspaceHardware.getActiveWorkspaceId()
        if (!workspaceId) return false
        const state = await getDoc<CouchDoc & { playbackStatus?: string }>(couch, workspaceDbName(workspaceId), 'show-state').catch(() => null)
        return state?.playbackStatus === 'playing'
      }, app.log),
    )
  async function backupAdmin(request: FastifyRequest, reply: FastifyReply, body: { adminUsername: string; adminPassword: string }): Promise<boolean> {
    const workspaceId = workspaceHardware.getActiveWorkspaceId()
    if (!workspaceId) {
      void reply.status(409).send({ status: 'error', message: 'Auf diesem Stage-Server ist keine Band aktiv.' })
      return false
    }
    if (!(await isWorkspaceAdmin(request, workspaceId, body.adminUsername, body.adminPassword))) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Backup settings refused: not this band\'s admin')
      void reply.status(403).send({ status: 'error', message: 'Nur ein Admin der aktiven Band.' })
      return false
    }
    return true
  }
  app.post('/server/backup/overview', async (request, reply) => {
    const parsed = BackupAdminRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await backupAdmin(request, reply, parsed.data))) return reply
    return reply.status(200).send(await backups.overview())
  })
  app.post('/server/backup/save', async (request, reply) => {
    const parsed = BackupSaveRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await backupAdmin(request, reply, parsed.data))) return reply
    backups.save(parsed.data.target)
    return reply.status(200).send(await backups.overview())
  })
  app.post('/server/backup/delete', async (request, reply) => {
    const parsed = BackupTargetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await backupAdmin(request, reply, parsed.data))) return reply
    backups.remove(parsed.data.targetId)
    return reply.status(200).send(await backups.overview())
  })
  app.post('/server/backup/run', async (request, reply) => {
    const parsed = BackupTargetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await backupAdmin(request, reply, parsed.data))) return reply
    // Runs in the background (minutes with backing tracks); the app follows it via overview.
    void backups.run(parsed.data.targetId, 'manual').catch((err) => app.log.error({ err }, 'Backup run failed'))
    return reply.status(202).send({ status: 'started' })
  })
  app.post('/server/backup/test', async (request, reply) => {
    const parsed = BackupTargetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await backupAdmin(request, reply, parsed.data))) return reply
    return reply.status(200).send(await backups.test(parsed.data.targetId))
  })

  // The status line in the app (Geräte → Stage-Server): the configured targets' summary; before
  // any target exists, the last run of a hand-started scripts/backup.mjs; null = never set up.
  app.get('/server/backup-status', async (_request, reply) => {
    const summary = backups.summary()
    if (summary) return reply.status(200).send(summary)
    const file = join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'backup-status.json')
    if (!existsSync(file)) return reply.status(200).send(null)
    try {
      return reply.status(200).send(JSON.parse(readFileSync(file, 'utf8')))
    } catch (err) {
      app.log.warn({ err }, 'backup-status.json unreadable')
      return reply.status(200).send({ ok: false, error: 'Status-Datei unlesbar' })
    }
  })

  app.get('/server/active-workspace', async (_request, reply) =>
    reply.status(200).send({ activeWorkspaceId: workspaceHardware.getActiveWorkspaceId() }),
  )

  // The admins of the band this box is currently serving - so the hardware-switch wizard can show
  // whose PIN closes it without asking for that band's code (it's already registered here; the
  // code exists to gate *joining*, not to gate stopping what the box itself is running). Only
  // names and ids, only for the active band: no workspace parameter, so it can't enumerate any
  // other band's roster. A PIN is still required to do anything with them (verify-admin-pin).
  app.get('/server/active-workspace/admins', async (_request, reply) => {
    const workspaceId = workspaceHardware.getActiveWorkspaceId()
    if (!workspaceId) {
      return reply.status(404).send({ status: 'error', message: 'No workspace is active on this server' })
    }
    const members = await readRoster(couch, workspaceId)
    return reply.status(200).send({
      workspaceId,
      admins: members.filter((m) => m.isAdmin).map(({ profileId, name }) => ({ profileId, name })),
    })
  })

  // 2026-09-02 fourth follow-up, at Marco's explicit request: consolidates the PWA, this API,
  // and CouchDB onto this one origin, so a new device only ever has to accept one self-signed
  // certificate exception - browsers trust per *origin* (scheme+host+port), not per-certificate,
  // so serving all three from three different ports (Vite, Fastify, CouchDB) meant every new
  // tablet needed up to three separate manual "trotzdem fortfahren" taps (docs/03 section 0a).
  //
  // Pure passthrough proxy, not a real integration: whatever Basic Auth header the client (a
  // real PouchDB instance, using that specific person's own CouchDB account) already sends
  // travels straight through to real CouchDB unmodified - this server's own trusted admin
  // `couch` credentials above are never injected here, and CouchDB itself still does every bit
  // of the actual authentication/authorization exactly as if the client had connected to it
  // directly. `stage-pwa`'s `workspaceDb.ts` now builds its remote database URL from this
  // server's own origin plus this `/db` prefix (`VITE_STAGE_SERVER_URL`) instead of a separate
  // `VITE_COUCHDB_URL` pointing at CouchDB's own port - one address to configure, not two.
  await app.register(httpProxy, {
    upstream: couch.url,
    prefix: '/db',
    rewritePrefix: '',
    // A band's database only for that band's own accounts. CouchDB's `_security` grants access by
    // role, and the roles (`member`, `admin`) are the same in every band - without this, any
    // band's device login could read and write every other band's database through here.
    preHandler: (request, reply, done) => {
      const refusal = bandDbProxyRefusal(request.url, request.headers.authorization)
      if (refusal) {
        app.log.warn({ url: request.url.split('?')[0], remoteAddress: request.ip, reason: refusal }, 'Database request for another band refused')
        void reply.status(403).send({ error: 'forbidden', reason: 'Not an account of this band' })
        return
      }
      // CouchDB itself never locks a login - an admin's password is their 4-digit PIN, so guessing
      // it here had no limit (#396 review). Same lock as the admin routes, shared per account.
      const login = basicAuthCredentials(request.headers.authorization)
      const lockedFor = login ? adminLoginThrottle.lockedForSeconds(login.username) : 0
      if (lockedFor > 0) {
        void reply.status(429).header('Retry-After', String(lockedFor)).send({ error: 'locked', reason: 'Too many wrong logins' })
        return
      }
      done()
    },
  })
  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/db')) return
    const login = basicAuthCredentials(request.headers.authorization)
    if (!login) return
    if (reply.statusCode === 401) {
      if (adminLoginThrottle.recordFailure(login.username)) {
        app.log.warn({ username: login.username, remoteAddress: request.ip }, 'Too many wrong database logins - locked out temporarily')
      }
    } else if (reply.statusCode < 400) {
      adminLoginThrottle.recordSuccess(login.username)
    }
  })

  // Serves stage-pwa's `vite build` output, if present - graceful fallback, same pattern as the
  // TLS certs above (see `certFile`/`keyFile`): without a build in place, this registers
  // nothing, and `npm run dev` in stage-pwa (Vite's own dev server, still its own origin) keeps
  // working exactly as before for day-to-day iteration. Only relevant for testing "as a real
  // device would see it" - one origin, one cert exception - or an actual gig. No SPA-fallback
  // routing needed: the app has no client-side URL router at all, just one `index.html` and
  // in-memory React state, so `@fastify/static`'s default file-or-404 behavior is already
  // exactly right - `/` is the only path anything ever actually requests.
  // The native Android app (#348), built by scripts/build-android-app.sh next to the server's data.
  registerAppRoutes(app, process.env.STAGEBOARD_APP_DIR ?? join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'app'))

  const pwaDist = fileURLToPath(new URL('../../stage-pwa/dist', import.meta.url))
  if (existsSync(pwaDist)) {
    await app.register(fastifyStatic, { root: pwaDist })
  }

  return { app, registry, lookupRegistry, couch, workspaceHardware, pluginLog, backups }
}

const port = Number(process.env.PORT ?? 3001)

/** Best-effort guess at "the" LAN address to advertise over mDNS, when `LAN_IP` isn't set
 * explicitly - the first non-internal IPv4 address on an interface that doesn't look like one
 * of Docker's own virtual ones. Skipping `docker*`/`br-*`/`veth*` matters: picking one of those
 * instead of the real network interface would advertise an address nothing outside this
 * machine can actually reach, and (found live, avahi hit exactly this) a Docker bridge
 * echoing multicast traffic back to itself is also what broke the earlier avahi-based attempt
 * at this same feature. */
function detectLanIp(): string | null {
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (/^(docker|br-|veth|lo)/.test(name)) continue
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return null
}

async function main() {
  const { app, lookupRegistry, workspaceHardware, pluginLog, couch, backups } = await buildApp()
  // Scheduled backups (daily time, USB medium plugged in) - checked every 30 s.
  backups.start()

  try {
    // Validator rules added after a band was founded (protected dashboard templates, #16) reach
    // its database here. A failure must not keep the server from starting.
    try {
      const updated = await updateRosterValidators(couch, (db, err) => app.log.error({ err, db }, 'Could not update the roster validator of this band'))
      if (updated.length > 0) app.log.info({ databases: updated }, 'Roster validator updated')
    } catch (err) {
      app.log.error({ err }, 'Could not update roster validators')
    }

    // Which plugins run is not configured here: the band installs them in the PWA, and the
    // installation documents replicate to this server over CouchDB (docs/01, mesh).
    //
    // 2026-09-02 fourteenth follow-up, at Marco's explicit request, after finding a phantom
    // empty "band-a" workspace kept reappearing in "Verfügbare Bands" no matter how often he
    // deleted it: this used to default to workspaceId 'band-a' when STAGEBOARD_WORKSPACE
    // wasn't set - a leftover from before the WiFi-style redesign, when a Stage-Server
    // belonged to exactly one fixed band. `start()` (pluginSync.ts) calls `ensureDb()`
    // unconditionally, which *creates* that database if it's missing - so every server
    // restart silently recreated an empty "band-a" nobody ever founded through the app. Now
    // this hardware/plugin sync simply doesn't run at all unless a real workspace is
    // deliberately configured, rather than ever phantom-creating one of its own.
    //
    // Later follow-up: which workspace that is no longer has to come from this env var every
    // time - once `POST /workspaces/:id/activate-hardware` has been called at least once, the
    // persisted choice (activeWorkspaceStateStore.ts) wins, surviving restarts on its own. The
    // env var is only the first-boot bootstrap for a truly fresh box that's never activated
    // anything yet.
    const bootWorkspaceId = readPersistedActiveWorkspace() ?? process.env.STAGEBOARD_WORKSPACE ?? null
    if (bootWorkspaceId) {
      await workspaceHardware.activate(bootWorkspaceId)
    }

    // Device Ledger's background reachability/hostname refresh (pingLoop.ts, Marco's explicit
    // request) - purely in-memory (deviceInfoStore.ts), no CouchDB access, so unlike
    // pluginSync/midiWatcher above it needs no configured STAGEBOARD_WORKSPACE and just runs
    // unconditionally for whichever workspaces happen to have reported devices.
    const pingLoop = startPingLoop()
    app.addHook('onClose', async () => pingLoop.stop())

    // Lookup plugins aren't band-installed hardware - they're always-available read-only data
    // sources, so every catalog entry just starts up directly rather than waiting on a
    // replicated installation doc the way PLUGIN_CATALOG's show-control plugins do.
    for (const createLookupPlugin of Object.values(LOOKUP_CATALOG)) {
      await lookupRegistry.register(createLookupPlugin(), { log: pluginLog })
    }
    app.addHook('onClose', async () => {
      for (const { name } of lookupRegistry.list()) {
        await lookupRegistry.unregister(name)
      }
    })

    // 2026-09-02 fifth follow-up, at Marco's explicit request: a device that types the bare
    // hostname/IP with no scheme at all (`stageboard.local`, not `https://stageboard.local`)
    // has its browser guess a scheme, and that guess is commonly plain `http://` - which this
    // server has nothing listening on to answer (it's HTTPS-only whenever certs exist, see
    // `buildApp()` above), so the request would just fail to connect. A tiny plain-HTTP
    // listener on port 80 exists purely to redirect straight to the HTTPS one, same origin and
    // path - the standard fix for "someone typed the bare domain". Only started when HTTPS is
    // actually active (`CERTS_AVAILABLE`) - with no TLS at all there's nothing to redirect
    // *to*. Binding port 80 needs the same privileged-port grant as 443 (`setcap
    // cap_net_bind_service` on node, docs/03) - if that's missing (e.g. a machine that's only
    // had 443 granted so far), this logs a warning and the main app on 443 keeps working
    // regardless; the redirect is a convenience, not a dependency. Registered (and the mDNS
    // block below) *before* `app.listen()` - Fastify forbids `addHook` once already listening
    // (found live: `FST_ERR_INSTANCE_ALREADY_LISTENING`), so both need to go first even though
    // neither actually depends on the HTTPS listener being up yet.
    if (CERTS_AVAILABLE) {
      const redirectServer = createServer((request, response) => {
        const host = (request.headers.host ?? 'stageboard.local').split(':')[0]
        response.writeHead(301, { Location: `https://${host}${request.url ?? '/'}` })
        response.end()
      })
      redirectServer.on('error', (err) => {
        app.log.warn({ err }, 'Could not start the port-80 HTTP->HTTPS redirect listener - the main HTTPS server is unaffected')
      })
      redirectServer.listen(80, '0.0.0.0')
      app.addHook('onClose', async () => {
        await new Promise<void>((resolve) => redirectServer.close(() => resolve()))
      })
    }

    // Advertises this workspace's friendly name over mDNS (docs/00's "Server Discovery" -
    // 2026-09-02 fifth follow-up, at Marco's explicit request for a name instead of a raw IP).
    // Deliberately NOT `/etc/avahi/hosts` (tried first, hits a well-documented avahi bug:
    // github.com/avahi/avahi/issues/40 - a static host entry collides with the machine's own
    // reverse-DNS record for that same address, every time) and not a full RFC 6762
    // implementation either (no probe/announce/conflict-detection dance) - this only answers
    // the one query that matters, "who is `mdnsHostname`", directly. `.local` is reserved
    // specifically so this coexists with a normal DNS server (a FritzBox, say) without
    // conflict - resolvers special-case that suffix to mDNS instead of asking the LAN's own
    // DNS server at all.
    //
    // Builds its own socket (`createMdnsSocket` in mdnsResponder.ts) rather than letting `multicast-dns`
    // create one, for one specific reason: this machine has Docker's own virtual network
    // interfaces (`docker0`, `br-*`) alongside the real one, and the library's default outgoing-
    // interface selection (`socket.setMulticastInterface('0.0.0.0')`, i.e. "let the OS pick")
    // isn't reliable in that situation - found live, same-machine tests (a second local
    // `multicast-dns` instance as a client) kept working throughout, because loopback delivery
    // doesn't depend on which interface a packet actually egresses on, but real devices on the
    // LAN (an Android tablet, a Windows PC in both Firefox and Edge - ruling out a browser-
    // specific DoH quirk) never received a response at all. Passing `interface: lanIp` to the
    // library directly was tried first as a fix and made things *worse* - it also changes the
    // socket's own bind address, and binding a UDP socket to one specific unicast address
    // instead of the wildcard silently breaks *receiving* multicast traffic at all on Linux, so
    // the responder stopped seeing queries entirely, confirmed with the same local-client test.
    // Building the socket by hand sidesteps both problems: bind stays wildcard (receiving keeps
    // working), while `setMulticastInterface(lanIp)` still pins sending to the real interface
    // explicitly (bypassing whatever ambiguity made '0.0.0.0' unreliable here).
    const lanIp = process.env.LAN_IP ?? detectLanIp()
    const mdnsHostname = process.env.MDNS_HOSTNAME ?? 'stageboard.local'
    if (lanIp) {
      // Never awaited and never throws: at boot the Wi-Fi may not have its address yet (#339) -
      // the responder retries on its own while the server already serves by raw IP.
      const mdns = startMdnsResponder({
        lanIp,
        hostname: mdnsHostname,
        port,
        // The name the native app lists this server under (#351).
        instance: process.env.MDNS_INSTANCE ?? `StageBoard ${hostname().split('.')[0]}`,
        certFingerprint: CERT_FINGERPRINT,
        log: pluginLog,
      })
      app.addHook('onClose', async () => mdns.stop())
    } else {
      app.log.warn('No LAN IP detected and LAN_IP not set - stageboard.local will not resolve, only the raw IP will work')
    }

    // #335: a stop (systemd restart, Ctrl+C) closes everything within seconds instead of hanging
    // until systemd SIGKILLs the process. Open SSE connections would hold `close()` open, so
    // they're dropped first. Registered before `listen()` (no addHook once listening).
    const dropConnections = trackConnections(app.server)
    app.addHook('preClose', async () => dropConnections())
    installShutdownHandlers(process, { close: () => app.close(), log: pluginLog, exit: (code) => process.exit(code) })

    await app.listen({ port, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// Only start the real server when this file is the process entrypoint (`tsx src/index.ts`
// or `node dist/index.js`) - not when it's imported, e.g. by index.test.ts for `buildApp()`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
