import { createSocket } from 'node:dgram'
import { AddonError, addonFilePath, addonRoot, installAddonVersion, previewAddon, pruneAddonVersions } from './addons/addonStore.js'
import { AddonInstallRequestSchema, AddonPreviewRequestSchema, HostAdminActionSchema, HostTimeAnswerSchema, LEASE_INTERVAL_MS, type BandHostEntry } from 'shared-types'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { CalibrationRuns } from './calibration/calibrationRuns.js'
import { listAudioInputs, MeasureInputStore, measureLevel } from './calibration/measureInputs.js'
import { fallbackMicDevice, startMicCapture } from './calibration/micCapture.js'
import { PIPER_SPEECH_PLUGIN_ID, serverSpeech, serverVoices } from './plugins/piperSpeechPlugin.js'
import { PiperSpeech } from './speech/piperSpeech.js'
import { createServer } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import httpProxy from '@fastify/http-proxy'
import { startBuiltinDatabase } from './builtinDatabase.js'
import { hostCapabilities } from './hostCapabilities.js'
import { createHostLeaseService, getFromHost, postJsonToHost } from './hostLeaseService.js'
import { createHostRoleStore } from './hostRoleStore.js'
import { makeLocalBandDb, makeRemoteBandDb } from './bandPouch.js'
import { createReplicationRunner } from './replicationRunner.js'
import { createAudioMirror } from './audioMirror.js'
import { createBandBootstrapStore, joinBandInvite, effectiveHosts, joinBand } from './bandJoin.js'
import { listHeldKeys, saveMirrorFile } from './audioMirrorFiles.js'
import { tracksOfVariantDocs } from 'sync-host'
import { createPinnedFetch } from './pinnedFetch.js'
import { corsOriginAllowed } from './corsOrigin.js'
import { HostLookupQuerySchema, lookUpHost } from './hostLookup.js'
import { configuredHostEpoch } from './hostEpochConfig.js'
import { createBandAccountsFor } from './bandAccounts.js'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import {
  ActivateProfileRequestSchema,
  SERVER_EXECUTION_TARGET,
  ActivateWorkspaceHardwareRequestSchema,
  CreateMemberRequestSchema,
  DeviceTriggerSchema,
  DiscoveryAssignRequestSchema,
  DiscoveryReportCandidateRequestSchema,
  DiscoveryStartRequestSchema,
  DiscoveryTriggeredRequestSchema,
  CalibrationRunRequestSchema,
  HealthReportSchema,
  GetAccessCodeRequestSchema,
  JoinAsMemberRequestSchema,
  ReadyReportSchema,
  RemoveMemberRequestSchema,
  RenameWorkspaceRequestSchema,
  SetMasterModeRequestSchema,
  RevokeDeviceRequestSchema,
  ForgetDeviceRequestSchema,
  RotateAccessCodeRequestSchema,
  SetMemberAdminRequestSchema,
  SetOwnPinRequestSchema,
  ShowControlEventSchema,
  VerifyAdminPinRequestSchema,
  WorkspaceDeleteRequestSchema,
  WorkspaceProvisionRequestSchema,
  type Device,
} from 'shared-types'
import { messageFieldsOf, serverMessage, type ServerMessage } from 'shared-types'
import { BackupAdminRequestSchema, BackupSaveRequestSchema, MeasureInputsSaveRequestSchema, MeasureLevelRequestSchema, type MeasureInputsOverview, BackupTargetRequestSchema, FlashReportSchema, ShowStatePushAckSchema, ShowStatePushSchema, SwitchStateEventSchema, SpeechSpeedSchema, SpeechVoiceKeySchema, YOUTUBE_VIDEO_ID_RE } from 'shared-types'
import { createBackupService, realBackupDeps, type BackupService } from './backup.js'
import { deleteAudioFile, readAudioFile, writeAudioFile } from './audioStore.js'
import { readPersistedActiveWorkspace } from './activeWorkspaceStateStore.js'
import { isSafePluginId, readPluginBundle } from './plugins/pluginBundleStore.js'
import { allDocs, deleteDocUnless, getDoc, putDoc, putDocWithRetry, type DatabaseConfig, type DatabaseDoc } from './database.js'
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
import { bandHasAddon, ULTIMATE_GUITAR_PLUGIN_ID, ULTIMATE_GUITAR_PROVIDER, YOUTUBE_DOWNLOAD_PLUGIN_ID } from './plugins/importAddons.js'
import { runYtDlpSearch } from './ytDlp.js'
import { LookupRegistry } from './plugins/lookupRegistry.js'
import { lookupErrorBody } from './plugins/lookupError.js'
import { presence as presenceStore } from './presenceStore.js'
import { registerHostRoutes } from './hostRoutes.js'
import { createBandJoin, createBandMembers, createHostRoutes, createReplicationAccountIssuer, type BandJoin } from 'sync-host'
import * as showStatePushHub from './showStatePushHub.js'
import * as switchStateHub from './switchStateHub.js'
import { PluginRegistry } from './plugins/registry.js'
import { createPinThrottle } from 'sync-host'
import { isLoopback, readDeletedWorkspaces } from './provisioningAuth.js'
import { listDbs } from './database.js'
import { decodeOscPacket, oscTargetFromConfig, setOscTargetResolver } from './plugins/oscPlugin.js'
import * as oscInHub from './oscInHub.js'
import { createWorkspaceHardwareController } from './workspaceHardwareController.js'
import {
  deprovisionWorkspace,
  deviceUsername,
  getOrCreateAccessCode,
  listWorkspaces,
  memberUsername,
  provisionWorkspace,
  updateRosterValidators,
  renameWorkspace,
  setMasterMode,
  rotateAccessCode,
  getAccessCode,
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
 * Why a request through the `/db` proxy must not reach the database, or null if it may: a path into a
 * band's database (`/db/stageboard-<band>/…`) needs Basic auth with an account of that band
 * (`stageboard-<band>-<profile>[~<device>]`). Everything else (`_security`, `_all_dbs`, …) is left to
 * the database. Band ids never extend each other (checked at provisioning), so the prefix is unambiguous.
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

const PROFILE_ID_PREFIX = 'profiles:'

/** The ids of the roster members whose `stageRoles` include `'admin'` - the source of truth for the "at least one
 * admin must remain" checks. Reads the roster itself: its `stageRoles` and each login's role are meant to always move
 * together (the app updates both in the same action), and the roster is the simpler, single query. */
async function adminProfileIds(database: DatabaseConfig, workspaceId: string): Promise<string[]> {
  const profiles = await allDocs<DatabaseDoc & { id?: string; stageRoles?: string[] }>(database, workspaceDbName(workspaceId), {
    startkey: PROFILE_ID_PREFIX,
    endkey: `${PROFILE_ID_PREFIX}￰`,
  })
  return profiles.flatMap((profile) => (profile.id && (profile.stageRoles ?? []).includes('admin') ? [profile.id] : []))
}

/** The roster as shown to a device mid-join (`POST /workspaces/:id/roster`, 2026-09-01
 * WiFi-style redesign) - every profile, deliberately without `requiresPassword` anymore
 * (2026-09-02 second follow-up): only `isAdmin` decides whether the joining device needs to
 * prompt for a code at all, see `RosterMemberSchema`'s doc comment in shared-types for the
 * full reasoning. */
async function readRoster(database: DatabaseConfig, workspaceId: string) {
  const profiles = await allDocs<DatabaseDoc & { id?: string; name?: string; stageRoles?: string[] }>(
    database,
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
 * the database sync, no LOOKUP_CATALOG registration, no `listen()`. Split out from `main()` so
 * tests can exercise real routes via `.inject()` without any of that I/O; `main()` is the
 * only caller that goes on to populate the registries and actually start the server.
 */
/** The UDP port OSC triggers arrive on (#484) - TouchOSC and most controllers send to 8000 by default. */
const OSC_IN_PORT = Number(process.env.STAGEBOARD_OSC_IN_PORT ?? 8000)

export async function buildApp(options: { backupService?: BackupService } = {}) {
  // Same shared cert as Vite and the database (see #34, scripts/generate-dev-certs.sh) - the
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

  // Admin database credentials - core-backend is the trusted, physically-secured Stage-Server
  // process, so unlike the PWA (see #12) it keeps using these directly, both for its own
  // plugin-sync data access and for the /workspaces provisioning route below, which needs
  // admin rights to create the database users and databases.
  const database: DatabaseConfig = {
    url: process.env.STAGEBOARD_DB_URL ?? 'http://localhost:5984',
    user: process.env.STAGEBOARD_DB_USER ?? 'admin',
    password: process.env.STAGEBOARD_DB_PASSWORD ?? 'admin',
  }
  // The accounts of every band: documents of the band's own database, the same ones the built-in database host signs
  // devices in with and the tablet writes (#960). One instance per band, with its own remembered logins.
  // The devices a band lists as its hosts have the role `host`, which lets them write the band's accounts with their own
  // sync (#960); the list is read when a login is checked, so `readBandHosts` (below) is there by then.
  const accountsFor = createBandAccountsFor(database, { hostDevices: async (workspaceId) => ((await readBandHosts(workspaceId)) ?? []).map((host) => host.hostId) })
  // Wrong tries at an admin's PIN, one count per workspace + profile - shared by joining, the PIN check and
  // activate-hardware, so none of them gives a fresh set of guesses (only 10,000 possibilities).
  const pinThrottle = createPinThrottle()
  // Wrong tries at a login on the admin routes and the database proxy, one count per login name.
  const adminLoginThrottle = createPinThrottle()
  const basicHeader = (username: string, password: string) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

  /** Whether `authorization` is a login of this band - remembered by the accounts for a few minutes, so a Play
   * doesn't wait for a database round trip each time. */
  async function isBandDevice(workspaceId: string, authorization: string | undefined): Promise<boolean> {
    const login = basicAuthCredentials(authorization)
    if (!login || !login.username.startsWith(`${workspaceDbName(workspaceId)}-`)) return false
    return (await accountsFor(workspaceId).login(authorization)) !== null
  }

  /** A device login of this band with the admin role (docs/32 §12a: only the admin installs add-ons). */
  async function isBandAdmin(workspaceId: string, authorization: string | undefined): Promise<boolean> {
    const login = basicAuthCredentials(authorization)
    if (!login || !login.username.startsWith(`${workspaceDbName(workspaceId)}-`)) return false
    return ((await accountsFor(workspaceId).login(authorization))?.roles ?? []).includes('admin')
  }

  // How a device becomes a member and an admin PIN is checked, and who manages the members: the rules of
  // sync-host, once for every host (#960) - the Stage-Server only brings its database, its code and its counts.
  const bandJoinDeps = (workspaceId: string) => ({
    accounts: accountsFor(workspaceId),
    throttle: pinThrottle,
    workspaceId,
    accessCode: async (): Promise<string | null> => {
      try {
        return (await getOrCreateAccessCode(database, workspaceId, workspaceId)).code
      } catch (err) {
        // A band whose database does not exist cannot be given a code: "no such band", answered like a wrong code.
        if (err instanceof Error && /: HTTP 404$/.test(err.message)) return null
        throw err
      }
    },
    profile: (profileId: string) => getDoc<DatabaseDoc & { stageRoles?: string[] }>(database, workspaceDbName(workspaceId), `${PROFILE_ID_PREFIX}${profileId}`),
  })
  const bandJoins = new Map<string, BandJoin>()
  const bandJoinFor = (workspaceId: string): BandJoin => {
    let join = bandJoins.get(workspaceId)
    if (!join) {
      join = createBandJoin(bandJoinDeps(workspaceId))
      bandJoins.set(workspaceId, join)
    }
    return join
  }
  const bandMembersFor = (workspaceId: string) =>
    createBandMembers({ ...bandJoinDeps(workspaceId), join: bandJoinFor(workspaceId), adminProfileIds: () => adminProfileIds(database, workspaceId), loginThrottle: adminLoginThrottle })


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

  // Tablets fetch this cross-origin (their own dev-server or PWA origin, not this server's).
  //
  // `methods` isn't derived from whatever routes actually exist - @fastify/cors defaults it to
  // the static string 'GET,HEAD,POST' if left unset, silently CORS-blocking every cross-origin
  // PUT/DELETE/PATCH (audio upload/delete, and now DELETE /workspaces/:id) at the browser's
  // preflight step, before the request even reaches a route handler. Found live, 2026-08-30:
  // DELETE /workspaces/:id's own test suite never caught this because fastify.inject() doesn't
  // go through real CORS at all.
  // The origins of the band's listed hosts are allowed too (#926); set once the lease service exists.
  let listedHostOrigins: () => string[] = () => []
  const configuredOrigins = (process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGINS).split(',')
  await app.register(cors, {
    origin: (origin, callback) => callback(null, corsOriginAllowed(origin, configuredOrigins, listedHostOrigins())),
    methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
    // Every PouchDB request through the /db proxy below sends `credentials: 'include'` (it
    // needs that for its own Basic Auth header) - without this, @fastify/cors never sends
    // Access-Control-Allow-Credentials at all, so the browser blocks the preflight outright
    // ("the value of the 'Access-Control-Allow-Credentials' header ... is '' which must be
    // 'true'"), and every live PouchDB<->the database sync fails forever, retrying with backoff
    // (Marco, 2026-09-14).
    credentials: true,
  })

  app.get('/health', async () => ({ status: 'ok' }))

  // The NTP-style "burst handshake" target (docs/00 §4, #31): clients hit this repeatedly and
  // keep the lowest-RTT sample's offset (see stage-pwa's clockSync.ts) - a single Date.now()
  // read is all a client needs, no session/state on this end.
  // The epoch is 1 until a backup takeover exists (host backup, #910; STAGEBOARD_HOST_EPOCH for tests, #924); hostId tells devices which host answers.
  const hostId = process.env.STAGEBOARD_HOST_ID || hostname()
  const hostEpoch = configuredHostEpoch()
  // Once a backup has taken over it serves band time (its clock + the primary's offset) under its own, higher epoch (#920).

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
  // Latency calibration with the Stage-Server's microphone (docs/21 §4, #491): a device asks for a
  // run, plays its click at the irregular times returned, and polls for the delay the server heard.
  // Which input listens (#662): the microphone for speakers, the cable for everything plugged in.
  const measureInputs = new MeasureInputStore()
  const calibrationRuns = new CalibrationRuns((kind) => {
    const input = measureInputs.resolve(kind)
    return startMicCapture(input.device, input.channel)
  })
  app.post('/calibration/runs', async (request, reply) => {
    const parsed = CalibrationRunRequestSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    const run = calibrationRuns.start(parsed.data.count, parsed.data.input ?? 'mic')
    if (!run) return reply.status(409).send({ status: 'error', ...serverMessage('calibration.busy') })
    app.log.info({ runId: run.id, deviceId: parsed.data.deviceId, input: parsed.data.input ?? 'mic', listensOn: measureInputs.resolve(parsed.data.input ?? 'mic'), clicks: run.times.length, recordUntil: run.recordUntil }, 'Calibration run started')
    return run
  })
  app.get('/calibration/runs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const status = calibrationRuns.get(id)
    if (!status) return reply.status(404).send({ status: 'error', ...serverMessage('calibration.unknownRun') })
    if (status.state === 'failed') app.log.error({ runId: id, error: status.error }, 'Calibration run failed')
    if (status.state === 'done') app.log.info({ runId: id, onsets: status.onsets, result: status.result }, 'Calibration run finished')
    return status
  })

  app.get('/server-info', async () => ({
    lanIp: process.env.LAN_IP ?? detectLanIp(),
    // The port this server listens on - a host off 443 (a laptop, a second server) must put it
    // into the invite QR, else a scan lands on whatever answers on 443 (#896).
    port: Number(process.env.PORT ?? 3001),
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

  // Named '/plugin-health', not '/health', to avoid colliding with the plain server-liveness
  // route above - this is a different concept (per-plugin reachability, not "is this
  // process up"). SSE, not WebSocket: the traffic is one-directional broadcast plus
  // occasional one-shot reports, which fits a kept-open Fastify reply and a plain POST with
  // no new dependency (see #49 follow-up - this replaces the old the database `plugin-health` doc).
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

    const unsubscribe = presenceStore().subscribe(workspaceId, (snapshot) => {
      reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`)
    })
    request.raw.on('close', unsubscribe)
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
    // Only a device of this band may change what every tablet plays - its own database login, as for
    // flash messages. Checked logins are remembered for a while: this is on the Play path.
    if (!(await isBandDevice(workspaceId, request.headers.authorization))) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Show-state push refused - not signed in to this band')
      return reply.status(401).send({ status: 'error', message: 'Only a device of this band can push the show state' })
    }
    const devices = showStatePushHub.broadcast(workspaceId, parsed.data)
    app.log.info({ workspaceId, deviceId: parsed.data.deviceId, issuedAt: parsed.data.issuedAt, receivedMs: Date.now() - parsed.data.issuedAt, keys: Object.keys(parsed.data.patch), devices }, 'Show state pushed')
    return reply.status(204).send()
  })

  // Switch states (docs/23 §11.5): a held blinder lights its button on every tablet at once. Any
  // device of the band may - device commands need no show control (§5a).
  // OSC as a trigger (#484): what the Stage-Server receives on its OSC port, to the devices that
  // listen - the master running the rules and a device learning a button.
  app.get('/workspaces/:workspaceId/osc-in/stream', (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    beginSseStream(request, reply)
    const unsubscribe = oscInHub.subscribe(workspaceId, (message) => {
      reply.raw.write(`data: ${JSON.stringify(message)}\n\n`)
    })
    request.raw.on('close', unsubscribe)
  })

  app.get('/osc-in/info', async () => ({ port: OSC_IN_PORT }))

  app.get('/workspaces/:workspaceId/switch-state/stream', (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    beginSseStream(request, reply)
    const unsubscribe = switchStateHub.subscribe(workspaceId, (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })
    request.raw.on('close', unsubscribe)
  })

  app.post('/workspaces/:workspaceId/switch-state/push', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = SwitchStateEventSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }
    if (!(await isBandDevice(workspaceId, request.headers.authorization))) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Switch state refused - not signed in to this band')
      return reply.status(401).send({ status: 'error', message: 'Only a device of this band can switch' })
    }
    const devices = switchStateHub.broadcast(workspaceId, parsed.data)
    if (parsed.data.kind !== 'held') app.log.info({ workspaceId, ...parsed.data, devices }, 'Switch state pushed')
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
    const existing = await getDoc<Device & DatabaseDoc>(database, workspaceDbName(workspaceId), docId)
    if (!existing) {
      return reply.status(404).send({ status: 'error', message: 'Unknown device' })
    }
    await putDocWithRetry<Device & DatabaseDoc>(database, workspaceDbName(workspaceId), docId, (current) => ({
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
    const existing = await getDoc<Device & DatabaseDoc>(database, db, docId)
    if (!existing) {
      request.log.info({ workspaceId, deviceId }, 'device forget: unknown device')
      return reply.status(404).send({ status: 'error', message: 'Unknown device' })
    }
    if (existing.revoked) {
      request.log.info({ workspaceId, deviceId }, 'device forget refused: blocked')
      return reply.status(409).send({ status: 'error', message: 'blocked' })
    }
    const hardware = await allDocs<DatabaseDoc & { name?: string; executionTarget?: string | null }>(database, db, {
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
    const result = await deleteDocUnless<Device & DatabaseDoc, 'blocked'>(database, db, docId, (existing) => (existing.revoked ? 'blocked' : null))
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
      return reply.status(200).send({ status: 'error', ...serverMessage('device.notConnected') })
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
    await discoverySessionStore.start(database, workspaceId, parsed.data.startedBy)
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

  // Spoken announcements (#63): a speech clip per text and voice, generated once with Piper and
  // cached - only while the band has the piper-speech plugin installed. Clips never change for the
  // same text and voice, so devices may cache them for good. The voices themselves are listed and
  // downloaded on request (voiceCatalog.ts), so the band picks one in the plugin's settings.
  const speechReady = (reply: FastifyReply) => {
    if (registry.get(PIPER_SPEECH_PLUGIN_ID)) return true
    void reply.status(404).send({ status: 'error', ...serverMessage('speech.pluginMissing') })
    return false
  }
  app.get('/speech', async (request, reply) => {
    const query = request.query as { text?: unknown; voice?: unknown; speed?: unknown }
    const text = PiperSpeech.normalise(String(query.text ?? ''))
    if (!text) return reply.status(400).send({ status: 'error', ...serverMessage('speech.textMissing') })
    const voice = query.voice === undefined || query.voice === '' ? undefined : SpeechVoiceKeySchema.safeParse(query.voice)
    if (voice && !voice.success) return reply.status(400).send({ status: 'error', ...serverMessage('speech.invalidVoice') })
    const speed = query.speed === undefined || query.speed === '' ? undefined : SpeechSpeedSchema.safeParse(Number(query.speed))
    if (speed && !speed.success) return reply.status(400).send({ status: 'error', ...serverMessage('speech.invalidSpeed') })
    if (!speechReady(reply)) return reply
    const result = await serverSpeech.speak(text, voice?.data, speed?.data)
    if (!result.ok) {
      app.log.error({ text, voice: voice?.data, reason: result.reason, message: result.message }, 'Speech clip failed')
      return reply.status(result.reason === 'unavailable' ? 503 : 500).send({ status: 'error', message: result.message, messageCode: result.messageCode, messageParams: result.messageParams })
    }
    if (result.generated) app.log.info({ text, voice: voice?.data, bytes: result.wav.length }, 'Speech clip generated')
    return reply.header('Content-Type', 'audio/wav').header('Cache-Control', 'public, max-age=31536000, immutable').send(result.wav)
  })
  app.get('/speech/voices', async (_request, reply) => {
    if (!speechReady(reply)) return reply
    return serverVoices.list(serverSpeech.piperInstalled())
  })
  app.get('/speech/voices/:key/license', async (request, reply) => {
    const key = SpeechVoiceKeySchema.safeParse((request.params as { key: string }).key)
    if (!key.success) return reply.status(400).send({ status: 'error', ...serverMessage('speech.invalidVoice') })
    if (!speechReady(reply)) return reply
    return serverVoices.license(key.data)
  })
  app.post('/speech/voices/:key/install', async (request, reply) => {
    const key = SpeechVoiceKeySchema.safeParse((request.params as { key: string }).key)
    if (!key.success) return reply.status(400).send({ status: 'error', ...serverMessage('speech.invalidVoice') })
    if (!speechReady(reply)) return reply
    const started = await serverVoices.install(key.data)
    if (!started) return reply.status(409).send({ status: 'error', ...serverMessage('speech.downloadBusy') })
    app.log.info({ voice: key.data }, 'Speech voice download started')
    return { status: 'ok' }
  })

  // Owns which single workspace's hardware (plugin sync, Discovery Mode's MIDI watcher) this
  // box currently serves - lives here, not in main(), so the activate-hardware route below can
  // reach the same instance main() activates at boot. deactivate() on close covers both a real
  // shutdown and every test's afterEach(() => app.close()).
  const workspaceHardware = createWorkspaceHardwareController({ database, registry, log: pluginLog })
  app.addHook('onClose', async () => workspaceHardware.deactivate())

  // A fresh backup has neither the band's host list nor its code in its own database yet: until the
  // copy brings them, the join file (#933) stands in; the database wins once it has two hosts.
  const bootstrapStore = createBandBootstrapStore(process.env.STAGEBOARD_STATE_DIR ?? './data')
  const readBandHosts = async (workspaceId: string) =>
    effectiveHosts(workspaceId, (await getDoc<DatabaseDoc & { hosts?: BandHostEntry[] }>(database, workspaceDbName(workspaceId), 'band-settings:band'))?.hosts ?? null, bootstrapStore.load())
  const readBandCode = async (workspaceId: string) => {
    const own = (await getAccessCode(database, workspaceId))?.code
    const boot = bootstrapStore.load()
    return own ?? (boot && boot.workspaceId === workspaceId ? boot.accessCode : null)
  }

  // Host backup, #918 (docs/25 §6e): the primary tells the backup every second that it is alive,
  // signed with the band code. The sender is started in main(), not here, so tests stay quiet.
  const selfUrl = `https://${process.env.LAN_IP ?? detectLanIp() ?? '127.0.0.1'}:${Number(process.env.PORT ?? 3001)}`
  const hostLease = createHostLeaseService({
    selfHostId: hostId,
    // The primary teaches a fresh, listed backup its band by itself (#945) - the admin only picks the host.
    selfUrl,
    selfFingerprint: CERT_FINGERPRINT,
    baseEpoch: hostEpoch,
    roleStore: createHostRoleStore(process.env.STAGEBOARD_STATE_DIR ?? './data'),
    workspaceId: () => workspaceHardware.getActiveWorkspaceId(),
    readHosts: (workspaceId) => readBandHosts(workspaceId),
    readAccessCode: (workspaceId) => readBandCode(workspaceId),
    post: (url, body, fingerprint) => postJsonToHost(url, body, fingerprint),
    // 1 s: on a local network a live host answers in milliseconds; a frozen one must not delay the takeover.
    get: (url, fingerprint) => getFromHost(url, fingerprint, 1_000),
    now: () => Date.now(),
    // The handback (#935): the returned primary copies the backup's data first, and never hands back during a song.
    catchUp: () => catchUp.status(),
    songRunning: async () => {
      const workspaceId = workspaceHardware.getActiveWorkspaceId()
      if (!workspaceId) throw new Error('no band')
      // A band that never played has no show-state yet: not running. A database that cannot be read throws: cannot tell.
      return (await getDoc<DatabaseDoc & { playbackStatus?: string }>(database, workspaceDbName(workspaceId), 'show-state'))?.playbackStatus === 'playing'
    },
  })
  listedHostOrigins = hostLease.listedOrigins
  // The primary hands the backup a login to copy the band database with, on a request signed with the
  // band code (#919). Anything that is not a good request gets an empty 403.
  const replicationAccounts = createReplicationAccountIssuer({
    selfHostId: hostId,
    workspaceId: () => workspaceHardware.getActiveWorkspaceId(),
    readHosts: (workspaceId) => readBandHosts(workspaceId),
    readAccessCode: (workspaceId) => readBandCode(workspaceId),
    mint: (workspaceId, backupHostId) => accountsFor(workspaceId).provisionDevice('host', backupHostId, false),
  })
  // A fresh backup is told once which band it backs up and where the primary is (#933). Only from the
  // host machine itself, like the other provisioning routes: the admin on a tablet has no way here.
  app.post('/host/join-band', async (request, reply) => {
    if (!isLoopback(request.ip)) return reply.status(403).send({ status: 'error', message: 'Only from the host machine itself' })
    const result = await joinBand(
      {
        selfHostId: hostId,
        selfUrl,
        activeWorkspaceId: () => workspaceHardware.getActiveWorkspaceId(),
        fetchPrimaryId: async (url, fingerprint) => {
          const answer = HostTimeAnswerSchema.safeParse(await getFromHost(`${url}/time`, fingerprint, 3_000))
          return answer.success ? (answer.data.hostId ?? null) : null
        },
        ensureLocalDb: async (workspaceId) => void (await makeLocalBandDb(database, workspaceId)),
        activate: (workspaceId) => workspaceHardware.activate(workspaceId),
        store: bootstrapStore,
      },
      request.body,
    )
    return result.ok ? { status: 'ok' } : reply.status(result.status).send({ status: 'error', message: result.message })
  })
  // The admin's hand-made host change (#943): "take over now" on the backup, "hand back now" on the primary.
  // Checked with the admin's device login of the band, as on the other admin routes.
  for (const [path, act] of [
    ['/host/take-over', async () => ({ result: await hostLease.takeoverNow(), ok: 'taken' })],
    ['/host/hand-back', async () => ({ result: hostLease.requestHandback(), ok: 'requested' })],
  ] as const) {
    app.post(path, async (request, reply) => {
      const parsed = HostAdminActionSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
      const workspaceId = workspaceHardware.getActiveWorkspaceId()
      if (!workspaceId) return reply.status(409).send({ status: 'error', message: 'This host serves no band' })
      if (!(await isWorkspaceAdmin(request, workspaceId, parsed.data.adminUsername, parsed.data.adminPassword))) {
        return reply.status(403).send({ status: 'error', message: 'Not this band\'s admin' })
      }
      const { result, ok } = await act()
      return result === ok ? { status: 'ok', result } : reply.status(409).send({ status: 'error', result })
    })
  }
  // A fresh backup is taught its band by the primary itself (#945): the primary sees the admin's new entry in
  // the band's host list and invites the still band-less host - the band code is the proof, checked with the
  // primary (its roster route is code-gated), and the invite names the host that must be us.
  const acceptJoinInvite = joinBandInvite({
    selfHostId: hostId,
    selfUrl,
    activeWorkspaceId: () => workspaceHardware.getActiveWorkspaceId(),
    verifyWithPrimary: async (primaryUrl, workspaceId, code, fingerprint) => {
      // Roster is gated by the standing band code; /time tells us who the primary is.
      // The roster route is a POST with the band code in the body (#364); a 200 means the code is right.
      const confirmed = await postJsonToHost(
        `${primaryUrl.replace(/\/+$/, '')}/workspaces/${encodeURIComponent(workspaceId)}/roster`,
        { code },
        fingerprint,
        3_000,
      )
      if (!confirmed) return null
      const time = await getFromHost(`${primaryUrl.replace(/\/+$/, '')}/time`, fingerprint, 3_000)
      return HostTimeAnswerSchema.safeParse(time).data?.hostId ?? null
    },
    ensureLocalDb: async (workspaceId) => void (await makeLocalBandDb(database, workspaceId)),
    activate: (workspaceId) => workspaceHardware.activate(workspaceId),
    store: bootstrapStore,
    now: () => Date.now(),
  })
  // Who a host is (host backup, #914): the stage app asks its *own* host to look up the address the admin
  // typed, so the page never has to trust a certificate it does not know yet - in the browser that would be
  // CORS, in the app a missing pin (#945).
  app.get('/host/look-up', async (request, reply) => {
    const parsed = HostLookupQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: 'An https host address is needed' })
    // A host the admin named, not yet trusted: no fingerprint to check it against.
    const host = await lookUpHost(parsed.data.address, (url) => getFromHost(url, undefined, 3_000))
    return host ?? reply.status(502).send({ status: 'error', message: 'That address does not answer as a Stage-Server' })
  })
  // The backup keeps its copy of the primary's database going; started in main() (#919).
  const replication = createReplicationRunner({
    selfHostId: hostId,
    workspaceId: () => workspaceHardware.getActiveWorkspaceId(),
    readHosts: (workspaceId) => readBandHosts(workspaceId),
    readAccessCode: (workspaceId) => readBandCode(workspaceId),
    requestAccount: (url, body, fingerprint) => postJsonToHost(url, body, fingerprint),
    makeRemote: makeRemoteBandDb,
    makeLocal: (workspaceId) => makeLocalBandDb(database, workspaceId),
    now: () => Date.now(),
  })
  app.addHook('onClose', async () => replication.stop())
  // The returned primary's copy of the backup's data (#935): while it is out of date it copies from the other host,
  // so what was written during the takeover is not lost when it hands back.
  const catchUp = createReplicationRunner({
    selfHostId: hostId,
    workspaceId: () => workspaceHardware.getActiveWorkspaceId(),
    readHosts: (workspaceId) => readBandHosts(workspaceId),
    readAccessCode: (workspaceId) => readBandCode(workspaceId),
    requestAccount: (url, body, fingerprint) => postJsonToHost(url, body, fingerprint),
    makeRemote: makeRemoteBandDb,
    makeLocal: (workspaceId) => makeLocalBandDb(database, workspaceId),
    now: () => Date.now(),
    copyFrom: (hosts, selfId) => (hostLease.outdated() ? (hosts.find((h) => h.hostId !== selfId) ?? null) : null),
  })
  app.addHook('onClose', async () => catchUp.stop())
  // The backup's audio: it fetches the tracks the replicated song variants list that it does not have
  // yet, from the primary (#919). One file at a time, only while it is the passive backup.
  const audioMirror = createAudioMirror({
    selfHostId: hostId,
    workspaceId: () => workspaceHardware.getActiveWorkspaceId(),
    readHosts: (workspaceId) => readBandHosts(workspaceId),
    passive: () => hostLease.passiveBackup(),
    listTracks: async (workspaceId) => tracksOfVariantDocs(await allDocs<DatabaseDoc & Record<string, unknown>>(database, workspaceDbName(workspaceId), { startkey: 'song-variants:', endkey: 'song-variants:\ufff0'})),
    heldKeys: listHeldKeys,
    fetchFile: async (baseUrl, fingerprint, variantId, trackId) => {
      const response = await createPinnedFetch(fingerprint)(`${baseUrl}/audio/${variantId}/${trackId}`)
      return response.ok ? Buffer.from(await response.arrayBuffer()) : null
    },
    saveFile: saveMirrorFile,
  })
  // The routes every host answers the same way - one table in sync-host, shared with the tablet's app (#949).
  registerHostRoutes(
    app,
    createHostRoutes({
      hostId,
      lease: hostLease,
      activeWorkspaceId: () => workspaceHardware.getActiveWorkspaceId(),
      hostLeaseExtra: () => ({ replication: replication.status(), catchUp: catchUp.status(), audio: audioMirror.status() }),
      acceptInvite: acceptJoinInvite,
      issueAccount: (body) => replicationAccounts.issue(body),
      joinBand: (workspaceId) => bandJoinFor(workspaceId),
      members: (workspaceId) => bandMembersFor(workspaceId),
      audio: { get: readAudioFile, put: (variantId, trackId, data) => writeAudioFile(variantId, trackId, Buffer.from(data)), remove: deleteAudioFile },
      presence: presenceStore(),
      deviceInfo: deviceInfoStore.deviceInfo(),
      band: {
        accessCode: async (workspaceId) => {
          try {
            const access = await getOrCreateAccessCode(database, workspaceId, workspaceId)
            return { code: access.code, name: access.name }
          } catch (err) {
            // A band whose database does not exist cannot be given a code (the backfill's write finds no database): that is
            // "no such band", answered like a wrong code - not a 500, which would tell a stranger which bands exist.
            if (err instanceof Error && /: HTTP 404$/.test(err.message)) return null
            throw err
          }
        },
        profileDocs: (workspaceId) =>
          allDocs<DatabaseDoc & Record<string, unknown>>(database, workspaceDbName(workspaceId), { startkey: PROFILE_ID_PREFIX, endkey: `${PROFILE_ID_PREFIX}￰` }),
      },
      isBandDevice,
    }),
  )

  // OSC devices (#484): host and port are the device's transport config for the Stage-Server
  // (Bühnentechnik), in the band whose hardware this server serves.
  setOscTargetResolver(async (logicalDeviceId) => {
    const workspaceId = workspaceHardware.getActiveWorkspaceId()
    if (!workspaceId || !logicalDeviceId) return null
    return oscTargetFromConfig(await getDoc<DatabaseDoc>(database, workspaceDbName(workspaceId), `device-transport-config:${SERVER_EXECUTION_TARGET}:${logicalDeviceId}`))
  })

  async function isWorkspaceAdmin(request: FastifyRequest, workspaceId: string, username: string, password: string): Promise<boolean> {
    if (!username.startsWith(`${workspaceDbName(workspaceId)}-`)) {
      app.log.warn({ workspaceId, username, remoteAddress: request.ip }, 'Admin login for another band refused')
      return false
    }
    if (adminLoginThrottle.lockedForSeconds(username) > 0) return false
    const ctx = await accountsFor(workspaceId).login(basicHeader(username, password))
    if (ctx?.roles.includes('admin')) {
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
    const answer = await bandJoinFor(workspaceId).verifyPin({ profileId, pin })
    if (answer.status === 200) return { ok: true }
    if (answer.status === 429) return { ok: false, retryAfterSeconds: (answer.body as { retryAfterSeconds: number }).retryAfterSeconds }
    if (pinThrottle.lockedForSeconds(`${workspaceId}:${profileId}`) > 0) {
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

  // Add-ons from their own repositories (docs/32 §12, #852): the host keeps each version's files,
  // checked against their SHA-256, and the devices load them from here - never from the internet.
  app.get('/addons/:id/:version/:file', async (request, reply) => {
    const { id, version, file } = request.params as { id: string; version: string; file: string }
    const path = addonFilePath(addonRoot(), id, version, file)
    if (!path) return reply.status(400).send({ status: 'error', message: 'Invalid add-on file' })
    const data = await readFile(path).catch(() => null)
    if (data === null) return reply.status(404).send({ status: 'error', message: 'No such add-on file kept' })
    // A version's files never change - only a new version does.
    reply.header('cache-control', 'public, max-age=31536000, immutable')
    return reply.type(file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream').send(data)
  })

  /** What the admin sees before installing: the latest release's manifest, publisher, source, size. */
  app.post('/workspaces/:workspaceId/addons/preview', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    if (!(await isBandAdmin(workspaceId, request.headers.authorization))) {
      return reply.status(403).send({ status: 'error', message: 'Only an admin of this band manages add-ons' })
    }
    const parsed = AddonPreviewRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    try {
      const { preview } = await previewAddon(parsed.data.repository, { apiBase: process.env.STAGEBOARD_GITHUB_API })
      return preview
    } catch (err) {
      if (err instanceof AddonError) return reply.status(422).send({ status: 'error', code: err.code, message: err.message })
      throw err
    }
  })

  /** Downloads and checks the latest release and keeps it (with the version before it, for
   * rollback). `expectedVersion`: what the admin saw in the preview - a newer release in between is
   * refused rather than installed unseen. The band's documents are written by the admin's device. */
  app.post('/workspaces/:workspaceId/addons/install', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    if (!(await isBandAdmin(workspaceId, request.headers.authorization))) {
      return reply.status(403).send({ status: 'error', message: 'Only an admin of this band manages add-ons' })
    }
    const parsed = AddonInstallRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    const deps = { apiBase: process.env.STAGEBOARD_GITHUB_API }
    try {
      const { preview, release } = await previewAddon(parsed.data.repository, deps)
      if (preview.manifest.version !== parsed.data.expectedVersion) {
        return reply.status(409).send({ status: 'error', code: 'version-changed', message: `The repository now offers ${preview.manifest.version}`, version: preview.manifest.version })
      }
      await installAddonVersion(preview.manifest, release, addonRoot(), deps)
      const keep = [preview.manifest.version, ...(parsed.data.previousVersion ? [parsed.data.previousVersion] : [])]
      await pruneAddonVersions(addonRoot(), preview.manifest.id, keep)
      app.log.info({ workspaceId, addon: preview.manifest.id, version: preview.manifest.version, repository: preview.repository }, 'Add-on version kept')
      return { ...preview, keptVersions: keep }
    } catch (err) {
      if (err instanceof AddonError) {
        app.log.warn({ workspaceId, repository: parsed.data.repository, code: err.code, detail: err.message }, 'Add-on install refused')
        return reply.status(422).send({ status: 'error', code: err.code, message: err.message })
      }
      throw err
    }
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

  /** Ultimate Guitar only for a band that installed its add-on (#546) - the app sends its band as
   * `workspace`. Other providers (MusicBrainz) need nothing. Returns the refusal, or null. */
  async function lookupRefusal(provider: string, workspace: string | undefined): Promise<ServerMessage | null> {
    if (provider !== ULTIMATE_GUITAR_PROVIDER) return null
    if (!workspace || !/^[a-z0-9_-]+$/i.test(workspace)) return serverMessage('ug.bandMissing')
    const installed = await bandHasAddon(database, workspace, ULTIMATE_GUITAR_PLUGIN_ID).catch(() => false)
    return installed ? null : serverMessage('ug.addonMissing')
  }

  app.get('/lookup/:provider/search', async (request, reply) => {
    const { provider } = request.params as { provider: string }
    const { q, workspace } = request.query as { q?: string; workspace?: string }
    if (!q) {
      return reply.status(400).send({ status: 'error', message: 'Missing query parameter q' })
    }
    const refusal = await lookupRefusal(provider, workspace)
    if (refusal) return reply.status(403).send({ status: 'error', ...refusal })

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
    const { resultId, workspace } = request.query as { resultId?: string; workspace?: string }
    if (!resultId) {
      return reply.status(400).send({ status: 'error', message: 'Missing query parameter resultId' })
    }
    const refusal = await lookupRefusal(provider, workspace)
    if (refusal) return reply.status(403).send({ status: 'error', ...refusal })

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

  /** The YouTube add-on (#546) for this band, or the refusal - like `lookupRefusal` for UG. */
  async function youtubeRefusal(workspace: string | undefined): Promise<ServerMessage | null> {
    if (!workspace || !/^[a-z0-9_-]+$/i.test(workspace)) return serverMessage('youtube.bandMissing')
    const installed = await bandHasAddon(database, workspace, YOUTUBE_DOWNLOAD_PLUGIN_ID).catch(() => false)
    return installed ? null : serverMessage('youtube.addonMissing')
  }

  // YouTube search for "Track hinzufügen" (#618): the same yt-dlp as the download, metadata only.
  app.get('/youtube/search', async (request, reply) => {
    const { q, workspace } = request.query as { q?: string; workspace?: string }
    if (!q?.trim()) return reply.status(400).send({ status: 'error', message: 'Missing query parameter q' })
    const refusal = await youtubeRefusal(workspace)
    if (refusal) return reply.status(403).send({ status: 'error', ...refusal })
    try {
      return await runYtDlpSearch(q.trim().slice(0, 200))
    } catch (err) {
      app.log.error({ err, q }, 'YouTube search failed')
      return reply.status(502).send({ status: 'error', ...messageFieldsOf(err) })
    }
  })

  // The hits' thumbnails through the Stage-Server (#618): the tablets on stage often have no
  // internet of their own, only the server does.
  app.get('/youtube/thumbnail', async (request, reply) => {
    const { id } = request.query as { id?: string }
    if (!id || !YOUTUBE_VIDEO_ID_RE.test(id)) return reply.status(400).send({ status: 'error', message: 'Invalid video id' })
    try {
      const response = await fetch(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`, { signal: AbortSignal.timeout(10_000) })
      if (!response.ok) return reply.status(404).send({ status: 'error', message: `Thumbnail HTTP ${response.status}` })
      return reply
        .type(response.headers.get('content-type') ?? 'image/jpeg')
        .header('cache-control', 'public, max-age=86400')
        .send(Buffer.from(await response.arrayBuffer()))
    } catch (err) {
      app.log.warn({ err, id }, 'YouTube thumbnail failed')
      return reply.status(502).send({ status: 'error', message: 'Thumbnail not reachable' })
    }
  })

  // Provisions a brand-new workspace: its database, `_security` doc, roster validation doc, and
  // the founding device's own personal account (see per-person-accounts follow-up -
  // every roster member gets their own account, the founder is just the first one, auto-admin).
  // Who may found a band (#364, Marco 2026-10-05): the first band on a fresh server anyone; every
  // further one only an admin of a band on this server (or the server machine itself).
  const adminProofThrottle = createPinThrottle()

  /** An admin login as proof for founding (any band's admin) - locked after 5 wrong tries per
   * account like the PIN routes, since an admin's anchor password is their 4-digit PIN. */
  async function isAnyBandAdmin(request: FastifyRequest, username: string, password: string): Promise<boolean> {
    const key = `admin:${username}`
    if (adminProofThrottle.lockedForSeconds(key) > 0) return false
    // The login names its band (`stageboard-<band>-<profile>[~<device>]`): the band whose database name it extends.
    const band = (await listDbs(database)).find((db) => db.startsWith('stageboard-') && username.startsWith(`${db}-`))
    const ctx = band ? await accountsFor(band.slice('stageboard-'.length)).login(basicHeader(username, password)) : null
    if (ctx?.roles.includes('admin')) {
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

    // A deleted band comes back only through the documented the database recovery (docs/03 §0b) -
    // this route handed its admin account to anyone before (#364, 2026-10-04).
    if (readDeletedWorkspaces().includes(workspaceId)) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Refused to provision a deleted band again')
      return reply.status(409).send({ status: 'error', code: 'deleted', message: 'This band was deleted - restore it via docs/03 §0b' })
    }

    // Accounts are tied to their band by name (`stageboard-<band>-<profile>`), so no band id may
    // extend another one - band "x-y" would otherwise own names that look like band "x"'s.
    const bandDbs = (await listDbs(database)).filter((db) => db.startsWith('stageboard-'))
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
      const credentials = await provisionWorkspace(database, workspaceId, parsed.data.founderId, parsed.data.workspaceName, {
        accounts: accountsFor(workspaceId),
        deviceId: parsed.data.deviceId ?? 'founding-device',
      })
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

  // Irreversibly destroys a workspace - same admin-verification pattern as the routes above.
  // Deletes the band's database - and with it every login and PIN, which are documents of it
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

    await deprovisionWorkspace(database, workspaceId)
    return reply.status(204).send()
  })

  // Public, no auth (2026-09-01 WiFi-style redesign, at Marco's request after being locked out
  // of every device at once) - every band this Stage-Server hosts, discoverable with no code at
  // all, the same way WiFi network names are visible before you enter a password. See
  // workspaceProvisioning.ts's `listWorkspaces` for the lazy-backfill behavior on a workspace
  // that predates this redesign.
  app.get('/workspaces', async (_request, reply) => {
    const workspaces = await listWorkspaces(database)
    return reply.status(200).send(workspaces)
  })

  // Public, no auth - the WiFi "enter the network's password" step, scoped to one workspace
  // picked from GET /workspaces above. `getOrCreateAccessCode` lazily creates a workspace's
  // standing code on first use if it predates this redesign - this route alone is what made
  // Marco's own locked-out workspace start working again, no separate migration needed. Hands
  // back names/roles only, never credentials - the joining device still has to pick who it is
  // (POST /workspaces/:workspaceId/join/:profileId below) before it gets anything real.

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

    const { code } = await getOrCreateAccessCode(database, workspaceId, workspaceId)
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

    const code = await rotateAccessCode(database, workspaceId)
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

    await renameWorkspace(database, workspaceId, parsed.data.name)
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
      await setMasterMode(database, workspaceId, parsed.data.masterMode)
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
    // some other workspace - unlike a bare verifyAdmin(), the flat 'admin' the database role is never
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
        const state = await getDoc<DatabaseDoc & { playbackStatus?: string }>(database, workspaceDbName(workspaceId), 'show-state').catch(() => null)
        return state?.playbackStatus === 'playing'
      }, app.log),
    )
  async function activeBandAdmin(request: FastifyRequest, reply: FastifyReply, body: { adminUsername: string; adminPassword: string }): Promise<boolean> {
    const workspaceId = workspaceHardware.getActiveWorkspaceId()
    if (!workspaceId) {
      void reply.status(409).send({ status: 'error', ...serverMessage('band.noneActive') })
      return false
    }
    if (!(await isWorkspaceAdmin(request, workspaceId, body.adminUsername, body.adminPassword))) {
      app.log.warn({ workspaceId, remoteAddress: request.ip }, 'Server setting refused: not this band\'s admin')
      void reply.status(403).send({ status: 'error', ...serverMessage('band.activeAdminOnly') })
      return false
    }
    return true
  }
  app.post('/server/backup/overview', async (request, reply) => {
    const parsed = BackupAdminRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    return reply.status(200).send(await backups.overview())
  })
  app.post('/server/backup/save', async (request, reply) => {
    const parsed = BackupSaveRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    backups.save(parsed.data.target)
    return reply.status(200).send(await backups.overview())
  })
  app.post('/server/backup/delete', async (request, reply) => {
    const parsed = BackupTargetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    backups.remove(parsed.data.targetId)
    return reply.status(200).send(await backups.overview())
  })
  app.post('/server/backup/run', async (request, reply) => {
    const parsed = BackupTargetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    // Runs in the background (minutes with backing tracks); the app follows it via overview.
    void backups.run(parsed.data.targetId, 'manual').catch((err) => app.log.error({ err }, 'Backup run failed'))
    return reply.status(202).send({ status: 'started' })
  })
  app.post('/server/backup/test', async (request, reply) => {
    const parsed = BackupTargetRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    return reply.status(200).send(await backups.test(parsed.data.targetId))
  })

  // Measuring inputs (docs/24 §7.2, #662): which of the server's audio inputs listens to speakers
  // (microphone) and to headphones / in-ear / Bluetooth (cable) - System → Rig-Check, admins only.
  app.post('/server/measure-inputs/overview', async (request, reply) => {
    const parsed = BackupAdminRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    const overview: MeasureInputsOverview = { inputs: await listAudioInputs(), selected: measureInputs.get(), fallbackMic: fallbackMicDevice() }
    return reply.status(200).send(overview)
  })
  app.post('/server/measure-inputs/save', async (request, reply) => {
    const parsed = MeasureInputsSaveRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    measureInputs.save(parsed.data.selected)
    app.log.info({ selected: parsed.data.selected }, 'Measuring inputs saved')
    return reply.status(200).send({ status: 'ok' })
  })
  app.post('/server/measure-inputs/level', async (request, reply) => {
    const parsed = MeasureLevelRequestSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    if (!(await activeBandAdmin(request, reply, parsed.data))) return reply
    // The device is in use while a calibration run records - one at a time.
    if (calibrationRuns.busy()) return reply.status(409).send({ status: 'error', ...serverMessage('calibration.busy') })
    const level = await measureLevel(parsed.data.input, parsed.data.durationMs ?? 2000)
    if (level.error) app.log.warn({ input: parsed.data.input, error: level.error }, 'Measuring input level failed')
    return reply.status(200).send(level)
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
      return reply.status(200).send({ ok: false, error: serverMessage('backup.statusUnreadable').message, errorCode: 'backup.statusUnreadable' })
    }
  })

  // What this host can run - the map offers server plugins by it (docs/25 §6, 2026-11-07).
  app.get('/server/capabilities', async () => hostCapabilities())


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
    const members = await readRoster(database, workspaceId)
    return reply.status(200).send({
      workspaceId,
      admins: members.filter((m) => m.isAdmin).map(({ profileId, name }) => ({ profileId, name })),
    })
  })

  // 2026-09-02 fourth follow-up, at Marco's explicit request: consolidates the PWA, this API,
  // and the database onto this one origin, so a new device only ever has to accept one self-signed
  // certificate exception - browsers trust per *origin* (scheme+host+port), not per-certificate,
  // so serving all three from three different ports (Vite, Fastify, the database) meant every new
  // tablet needed up to three separate manual "trotzdem fortfahren" taps (docs/03 section 0a).
  //
  // Pure passthrough proxy, not a real integration: whatever Basic Auth header the client (a
  // real PouchDB instance, using that specific person's own account) already sends
  // travels straight through to real the database unmodified - this server's own trusted admin
  // `database` credentials above are never injected here, and the database itself still does every bit
  // of the actual authentication/authorization exactly as if the client had connected to it
  // directly. `stage-pwa`'s `workspaceDb.ts` now builds its remote database URL from this
  // server's own origin plus this `/db` prefix (`VITE_STAGE_SERVER_URL`) instead of a separate
  // `VITE_DB_URL` pointing at the database's own port - one address to configure, not two.
  await app.register(httpProxy, {
    upstream: database.url,
    prefix: '/db',
    rewritePrefix: '',
    // A band's database only for that band's own accounts. the database's `_security` grants access by
    // role, and the roles (`member`, `admin`) are the same in every band - without this, any
    // band's device login could read and write every other band's database through here.
    preHandler: (request, reply, done) => {
      const refusal = bandDbProxyRefusal(request.url, request.headers.authorization)
      if (refusal) {
        app.log.warn({ url: request.url.split('?')[0], remoteAddress: request.ip, reason: refusal }, 'Database request for another band refused')
        void reply.status(403).send({ error: 'forbidden', reason: 'Not an account of this band' })
        return
      }
      // the database itself never locks a login - an admin's password is their 4-digit PIN, so guessing
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

  return { app, registry, lookupRegistry, database, workspaceHardware, pluginLog, backups, hostLease, replication, audioMirror, catchUp }
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
  // The one database (docs/25, #960): the small host from sync-host runs in this process, its data in
  // LevelDB files, where the database used to listen - everything below talks to it over HTTP. The band's logins and PINs are
  // documents of each band database, so there is nothing else to keep: no the database, no account list of its own.
  const builtinDb = await startBuiltinDatabase({
    dataDir: process.env.STAGEBOARD_DB_DIR ?? join(process.env.STAGEBOARD_STATE_DIR ?? './data', 'database'),
    user: process.env.STAGEBOARD_DB_USER ?? 'admin',
    password: process.env.STAGEBOARD_DB_PASSWORD ?? 'admin',
    port: Number(process.env.STAGEBOARD_DB_PORT ?? 5984),
  })
  process.env.STAGEBOARD_DB_URL = builtinDb.url
  const { app, lookupRegistry, workspaceHardware, pluginLog, database, backups, hostLease, replication, audioMirror, catchUp } = await buildApp()
  app.log.info({ url: builtinDb.url }, 'Built-in database host')
  // Scheduled backups (daily time, USB medium plugged in) - checked every 30 s.
  backups.start()

  try {
    // Validator rules added after a band was founded (protected dashboard templates, #16) reach
    // its database here. A failure must not keep the server from starting.
    try {
      const updated = await updateRosterValidators(database, (db, err) => app.log.error({ err, db }, 'Could not update the roster validator of this band'))
      if (updated.length > 0) app.log.info({ databases: updated }, 'Roster validator updated')
    } catch (err) {
      app.log.error({ err }, 'Could not update roster validators')
    }

    // Which plugins run is not configured here: the band installs them in the PWA, and the
    // installation documents replicate to this server over the database (docs/01, mesh).
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
    // request) - purely in-memory (deviceInfoStore.ts), no the database access, so unlike
    // pluginSync/midiWatcher above it needs no configured STAGEBOARD_WORKSPACE and just runs
    // unconditionally for whichever workspaces happen to have reported devices.
    const pingLoop = startPingLoop()

    // The alive signal to the backup (#918), every second; does nothing unless this host is the
    // band's listed primary.
    const leaseTimer = setInterval(() => void hostLease.sendOnce(), LEASE_INTERVAL_MS)
    // The backup follows the primary's clock like any device (#919), every 2 s.
    const clockTimer = setInterval(() => void hostLease.sampleOnce(), 2_000)
    // ... and takes over when the primary is gone (#920); one check a second.
    // The backup's copy of the primary's database (#919), checked every 5 s until it runs.
    const replicationTimer = setInterval(() => void replication.tick(), 5_000)
    // ... and its audio (#919), every 15 s: a track fetch can take a while, the mirror runs one at a time.
    const audioTimer = setInterval(() => void audioMirror.tick(), 15_000)
    // A returned primary copies the backup's data and, when it is safe, takes the host role back (#935).
    const catchUpTimer = setInterval(() => void catchUp.tick(), 5_000)
    const handbackTimer = setInterval(() => void hostLease.handbackCheck().then((r) => r === 'handed-back' && pluginLog.info('host handback: this host is the band host again', { epoch: hostLease.epoch() })), 1_000)
    const takeoverTimer = setInterval(() => void hostLease.takeoverCheck().then((r) => r === 'taken' && pluginLog.info('host takeover: this host is the band host now', { epoch: hostLease.epoch() })), 1_000)
    app.addHook('onClose', async () => {
      clearInterval(leaseTimer)
      clearInterval(clockTimer)
      clearInterval(takeoverTimer)
      clearInterval(catchUpTimer)
      clearInterval(handbackTimer)
      clearInterval(replicationTimer)
      clearInterval(audioTimer)
    })

    // OSC in (#484): one UDP port for the whole box; what arrives goes to the band whose hardware
    // it serves (like the MIDI watcher). 0 switches it off.
    if (OSC_IN_PORT > 0) {
      const oscIn = createSocket('udp4')
      oscIn.on('message', (packet, remote) => {
        const workspaceId = workspaceHardware.getActiveWorkspaceId()
        const messages = decodeOscPacket(packet)
        if (!workspaceId || messages.length === 0) return
        for (const message of messages) {
          const devices = oscInHub.broadcast(workspaceId, { ...message, at: Date.now() })
          pluginLog.info('osc in', { address: message.address, args: message.args.length, from: remote.address, devices })
        }
      })
      oscIn.on('error', (err) => pluginLog.error('osc in: port unavailable', { port: OSC_IN_PORT, error: err.message }))
      oscIn.bind(OSC_IN_PORT)
      app.addHook('onClose', async () => oscIn.close())
    }
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
