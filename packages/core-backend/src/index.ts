import { createSocket } from 'node:dgram'
import { AddonError, addonFilePath, addonRoot, installAddonVersion, previewAddon, pruneAddonVersions } from './addons/addonStore.js'
import { AddonInstallRequestSchema, AddonPreviewRequestSchema, HostAdminActionSchema, HostTimeAnswerSchema, LEASE_INTERVAL_MS, type BandHostEntry } from 'shared-types'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { CalibrationRuns } from './calibration/calibrationRuns.js'
import { MeasureInputStore } from './calibration/measureInputs.js'
import { startMicCapture } from './calibration/micCapture.js'
import { hostSettingsRoutes } from './hostSettingsRoutes.js'
import { hostSpeech, hostVoices } from './speech/hostSpeech.js'
import { PiperSpeech } from './speech/piperSpeech.js'
import { createServer } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import { laptopDatabase } from './databaseRoutes.js'
import { startBuiltinDatabase, type BuiltinDatabase } from './builtinDatabase.js'
import { addonHostNeeds, hostCapabilities } from './hostCapabilities.js'
import { builtinRunners } from './builtinRunners.js'
import { pluginIdProviding, sharedAddonMethods } from './addons/addonMethods.js'
import { relayAddonState } from './addons/stateRelay.js'
import { createHostLeaseService, getFromHost, postJsonToHost } from './hostLeaseService.js'
import { createHostRoleStore } from './hostRoleStore.js'
import { makeLocalBandDb, makeRemoteBandDb } from './bandPouch.js'
import { createAudioMirror, createReplicationRunner } from 'sync-host'
import { createBandBootstrapStore } from './bandJoin.js'
import { withLegacyPath, createVerifyWithPrimary, joinBandInvite, effectiveHosts, joinBand } from 'sync-host'
import { listHeldKeys, saveMirrorFile } from './audioMirrorFiles.js'
import { tracksOfVariantDocs, type HostRouteResponse } from 'sync-host'
import { createPinnedFetch } from './pinnedFetch.js'
import { corsOriginAllowed } from './corsOrigin.js'
import { HostLookupQuerySchema, lookUpHost } from './hostLookup.js'
import { configuredHostEpoch } from './hostEpochConfig.js'
import { createBandAccountsFor } from './bandAccounts.js'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import {
  LEGACY_HOST_TARGET,
  ActivateWorkspaceHardwareRequestSchema,
  CalibrationRunRequestSchema,
  ShowControlEventSchema,
  type Device,
} from 'shared-types'
import { CAPABILITIES, messageFieldsOf, hostMessage, type HostMessage } from 'shared-types'
import { createBackupService, realBackupDeps, type BackupService } from './backup.js'
import { deleteAudioFile, readAudioFile, writeAudioFile } from './audioStore.js'
import { readPersistedActiveWorkspace } from './activeWorkspaceStateStore.js'
import { isSafePluginId, readPluginBundle } from './plugins/pluginBundleStore.js'
import { allDocs, getDoc, type DatabaseConfig, type DatabaseDoc } from './database.js'
import * as deviceInfoStore from './deviceInfoStore.js'
import { installShutdownHandlers, trackConnections } from './gracefulShutdown.js'
import { appDir, appRoutes } from './appDownload.js'
import { certFingerprint } from './certFingerprint.js'
import { startMdnsResponder } from './mdnsResponder.js'
import { startPingLoop } from './pingLoop.js'
import { LOOKUP_ADDONS, LOOKUP_CATALOG } from './plugins/lookupCatalog.js'
import { bandHasAddon } from './addons/bandAddons.js'
import { LookupRegistry } from './plugins/lookupRegistry.js'
import { lookupErrorBody } from './plugins/lookupError.js'
import { presence as presenceStore } from './presenceStore.js'
import { registerHostPipeline } from './hostPipeline.js'
import { addonRefusal, canDoFromCapabilities, createBandCatalog, createHostChannels } from 'sync-host'
import { createLaptopBandStore } from './bandStore.js'
import { answerHostRequest, createBandJoin, createBandMembers, createReplicationAccountIssuer, type BandJoin, type HostRequestDeps, type HostRoute, type HostRoutesDeps, type HostStream } from 'sync-host'
import { PluginRegistry } from './plugins/registry.js'
import { createPinThrottle } from 'sync-host'
import { isLoopback } from './provisioningAuth.js'
import { listDbs } from './database.js'
import { decodeOscPacket, oscTargetFromConfig, setOscTargetResolver } from './plugins/oscPlugin.js'
import { createWorkspaceHardwareController } from './workspaceHardwareController.js'
import { migrateHostTarget } from './migrations/hostTarget.js'
import { registerHostDevice } from './migrations/registerHostDevice.js'
import {
  getOrCreateAccessCode,
  updateRosterValidators,
  getAccessCode,
  workspaceDbName,
} from './workspaceProvisioning.js'

const certFile = fileURLToPath(new URL('../../../certs/dev-cert.pem', import.meta.url))
const keyFile = fileURLToPath(new URL('../../../certs/dev-key.pem', import.meta.url))
/** Computed once, at module load: whether this host will actually listen over HTTPS (see
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
 * (Capacitor, #348): its UI is bundled in the APK, so every host call is cross-origin. */
const DEFAULT_FRONTEND_ORIGINS = [
  `${CERTS_AVAILABLE ? 'https' : 'http'}://localhost:5173`,
  `${CERTS_AVAILABLE ? 'https' : 'http'}://stageboard.local:5173`,
  'https://localhost',
].join(',')

/** Username and password from an `Authorization: Basic …` header, or null. */
export function basicAuthCredentials(header: string | undefined): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const colon = decoded.indexOf(':')
  if (colon <= 0) return null
  return { username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
}

/** SHA-256 fingerprint of the host's certificate (lowercase hex, no separators), or null
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
 * Wires up the Fastify instance and every route, with fresh, empty plugin registries - no
 * the database sync, no LOOKUP_CATALOG registration, no `listen()`. Split out from `main()` so
 * tests can exercise real routes via `.inject()` without any of that I/O; `main()` is the
 * only caller that goes on to populate the registries and actually start the host.
 */
/** The UDP port OSC triggers arrive on (#484) - TouchOSC and most controllers send to 8000 by default. */
const OSC_IN_PORT = Number(process.env.STAGEBOARD_OSC_IN_PORT ?? 8000)

export async function buildApp(options: { backupService?: BackupService; databaseHost?: BuiltinDatabase['handle'] } = {}) {
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
  // this is a LAN-only host (docs/01), so a generous ceiling costs nothing real.
  const bodyLimit = Number(process.env.MAX_AUDIO_UPLOAD_BYTES ?? 200 * 1024 * 1024)

  // Admin database credentials - core-backend is the trusted, physically-secured Host
  // process, so unlike the PWA (see #12) it keeps using these directly, both for its own
  // plugin-sync data access and for the /workspaces provisioning route below, which needs
  // admin rights to create the database users and databases.
  const database: DatabaseConfig = {
    url: process.env.STAGEBOARD_DB_URL ?? 'http://localhost:5984',
    user: process.env.STAGEBOARD_DB_USER ?? 'admin',
    password: process.env.STAGEBOARD_DB_PASSWORD ?? 'admin',
  }
  // The live channels every host has (#962): one port over this process's stores; Discovery reads the band's plugins and
  // logical devices from the database host.
  const channels = createHostChannels({
    presence: presenceStore(),
    readBandDocs: (workspaceId, prefix) => allDocs<unknown>(database, workspaceDbName(workspaceId), { startkey: prefix, endkey: `${prefix}\uffff` }),
  })
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
  // sync-host, once for every host (#960) - the Host only brings its database, its code and its counts.
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
  // Latency calibration with the Host's microphone (docs/21 §4, #491): a device asks for a
  // run, plays its click at the irregular times returned, and polls for the delay the host heard.
  // Which input listens (#662): the microphone for speakers, the cable for everything plugged in.
  const measureInputs = new MeasureInputStore()
  const calibrationRuns = new CalibrationRuns((kind) => {
    const input = measureInputs.resolve(kind)
    return startMicCapture(input.device, input.channel)
  })
  // Every route of the Node shell's own (#964, step 2), answered through the host pipeline below together with the shared ones.
  const nodeRoutes: HostRoute[] = []
  const ownRoutes = (routes: readonly HostRoute[]) => {
    nodeRoutes.push(...routes)
  }
  // The Node shell's own routes as a table (#964, step 2): the calibration runs (a Node job, #662), who this host is, its OSC port.
  ownRoutes([
    {
      method: 'POST',
      pattern: '/calibration/runs',
      handle: async (request) => {
        const parsed = CalibrationRunRequestSchema.safeParse(request.body ?? {})
        if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
        const run = calibrationRuns.start(parsed.data.count, parsed.data.input ?? 'mic')
        if (!run) return { status: 409, body: { status: 'error', ...hostMessage('calibration.busy') } }
        app.log.info({ runId: run.id, deviceId: parsed.data.deviceId, input: parsed.data.input ?? 'mic', listensOn: measureInputs.resolve(parsed.data.input ?? 'mic'), clicks: run.times.length, recordUntil: run.recordUntil }, 'Calibration run started')
        return { status: 200, body: run }
      },
    },
    {
      method: 'GET',
      pattern: '/calibration/runs/:id',
      handle: async (request) => {
        const id = decodeURIComponent(request.params.id ?? '')
        const status = calibrationRuns.get(id)
        if (!status) return { status: 404, body: { status: 'error', ...hostMessage('calibration.unknownRun') } }
        if (status.state === 'failed') app.log.error({ runId: id, error: status.error }, 'Calibration run failed')
        if (status.state === 'done') app.log.info({ runId: id, onsets: status.onsets, result: status.result }, 'Calibration run finished')
        return { status: 200, body: status }
      },
    },
    ...withLegacyPath('/host/info').map((pattern) => ({
      method: 'GET' as const,
      pattern,
      handle: async () => ({
        status: 200,
        body: {
          lanIp: process.env.LAN_IP ?? detectLanIp(),
          // The port this host listens on - a host off 443 (a laptop, a second host) must put it into the invite QR, else a scan lands on
          // whatever answers on 443 (#896).
          port: Number(process.env.PORT ?? 3001),
          hostname: process.env.MDNS_HOSTNAME ?? 'stageboard.local',
          certFingerprint: CERT_FINGERPRINT,
        },
      }),
    })),
    // OSC as a trigger (#484): the UDP port is a capability of this box; what arrives goes to the band's listeners.
    { method: 'GET', pattern: '/osc-in/info', handle: async () => ({ status: 200, body: { port: OSC_IN_PORT } }) },
  ])

  // Audio tracks arrive as whatever mime type the browser's Blob carries (audio/mpeg,
  // audio/wav, ...) - Fastify only parses application/json and text/plain by default, so
  // anything else needs an explicit parser or gets rejected as unsupported media type.
  // A '*' fallback only ever applies to content types with no more specific parser
  // registered, so this doesn't touch the existing JSON routes above/below it.
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, payload, done) => {
    done(null, payload)
  })

  // The live channels (#962, step 2) are sync-host's: what a device sends into one (show state, switches, plugin health,
  // device triggers, Discovery) is answered by the shared route table, and what it listens to is one transport here -
  // each snapshot as a host-sent event. A named '/plugin-health', not '/health': per-plugin reachability, not liveness.
  // No login on a stream: a page opens it with EventSource, which cannot send one (presence reveals only which
  // already-visible roster member is active).
  const streamParam = (value: string) => {
    try {
      return decodeURIComponent(value)
    } catch {
      return null
    }
  }
  const streamOf = (path: string): HostStream | null => {
    const band = /^\/workspaces\/([^/]+)\/(show-state|switch-state|presence|osc-in|discovery|device-state)\/stream$/.exec(path)
    if (band) {
      const workspaceId = streamParam(band[1]!)
      const topic = band[2] as 'show-state' | 'switch-state' | 'presence' | 'osc-in' | 'discovery' | 'device-state'
      return workspaceId === null ? null : (send) => channels.subscribe(topic, workspaceId, send)
    }
    const health = /^\/plugin-health\/([^/]+)\/stream$/.exec(path)
    if (health) {
      const workspaceId = streamParam(health[1]!)
      return workspaceId === null ? null : (send) => channels.subscribe('plugin-health', workspaceId, send)
    }
    const trigger = /^\/workspaces\/([^/]+)\/devices\/([^/]+)\/trigger-stream$/.exec(path)
    if (trigger) {
      const workspaceId = streamParam(trigger[1]!)
      const deviceId = streamParam(trigger[2]!)
      return workspaceId === null || deviceId === null ? null : (send) => channels.subscribeDevice(workspaceId, deviceId, send)
    }
    return null
  }

  const registry = new PluginRegistry()

  const pluginLog = {
    info: (msg: string, meta?: Record<string, unknown>) => app.log.info(meta ?? {}, msg),
    error: (msg: string, meta?: Record<string, unknown>) => app.log.error(meta ?? {}, msg),
  }

  // Owns which single workspace's hardware (plugin sync, Discovery Mode's MIDI watcher) this
  // box currently serves - lives here, not in main(), so the activate-hardware route below can
  // reach the same instance main() activates at boot. deactivate() on close covers both a real
  // shutdown and every test's afterEach(() => app.close()).
  // What this host can do: its runners (#964, step 3) - capabilities and what a background job needs are derived from them.
  const runners = builtinRunners()
  /** The add-ons whose methods this device runs (docs/36, #964) - each in a sandbox of its own, started when first asked. */
  const addonMethods = sharedAddonMethods(pluginLog)
  const workspaceHardware = createWorkspaceHardwareController({
    database,
    registry,
    log: pluginLog,
    // Bands from before host ids bound this host's hardware to the word 'server' (#964). The host that is the band's primary - or the only one it
    // has - rewrites that to its own id; a backup leaves it, because the word meant the primary.
    afterActivate: async (workspaceId) => {
      // The host is a device of the band too (#964): it enters the device list under its id, whichever role it has.
      await registerHostDevice(database, workspaceId, hostId, hostname().split('.')[0] || hostId)
      const hosts = (await readBandHosts(workspaceId)) ?? []
      const primary = hosts.find((h) => h.priority === 1)
      if (hosts.length > 0 && primary?.hostId !== hostId) return
      const changed = await migrateHostTarget(database, workspaceId, hostId)
      if (changed > 0) pluginLog.info('Rewrote the legacy host word to this host id', { workspaceId, hostId, changed })
    },
    // Background jobs (#964): this host takes the ones its own capabilities say it can do, and leaves the rest queued only when the
    // band lists another host that might. Looked up when asked - the host list and the capabilities can change while it runs.
    jobHost: {
      hostId,
      needsOf: (job) => runners.needsOfJob(job),
      addonMethods,
      canDo: (needs) => canDoFromCapabilities(hostCapabilities(runners))(needs),
      hasPeers: async () => {
        const workspaceId = workspaceHardware.getActiveWorkspaceId()
        return workspaceId ? ((await readBandHosts(workspaceId))?.length ?? 0) >= 2 : false
      },
    },
  })
  // What an add-on's devices publish (docs/36 §5a) is checked against its manifest and shared with the band this host serves.
  addonMethods.onState((addonId, body) => {
    relayAddonState({ channels, workspaceId: workspaceHardware.getActiveWorkspaceId() ?? null, addonId, body, declared: addonMethods.declaredState(addonId), log: pluginLog })
  })
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
  ownRoutes([
    {
      method: 'POST',
      pattern: '/host/join-band',
      handle: async (request) => {
        if (!isLoopback(request.remoteAddress ?? '')) return { status: 403, body: { status: 'error', message: 'Only from the host machine itself' } }
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
        return result.ok ? { status: 200, body: { status: 'ok' } } : { status: result.status, body: { status: 'error', message: result.message } }
      },
    },
    // The admin's hand-made host change (#943): "take over now" on the backup, "hand back now" on the primary. Checked with the admin's device
    // login of the band, as on the other admin routes.
    ...([
      ['/host/take-over', async () => ({ result: await hostLease.takeoverNow(), ok: 'taken' })],
      ['/host/hand-back', async () => ({ result: hostLease.requestHandback(), ok: 'requested' })],
    ] as const).map(([pattern, act]) => ({
      method: 'POST' as const,
      pattern,
      handle: async (request: { body?: unknown; remoteAddress?: string }): Promise<HostRouteResponse> => {
        const parsed = HostAdminActionSchema.safeParse(request.body)
        if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
        const workspaceId = workspaceHardware.getActiveWorkspaceId()
        if (!workspaceId) return { status: 409, body: { status: 'error', message: 'This host serves no band' } }
        if (!(await checkBandAdmin(workspaceId, parsed.data.adminUsername, parsed.data.adminPassword, request.remoteAddress))) {
          return { status: 403, body: { status: 'error', message: 'Not this band\'s admin' } }
        }
        const { result, ok } = await act()
        return result === ok ? { status: 200, body: { status: 'ok', result } } : { status: 409, body: { status: 'error', result } }
      },
    })),
  ])


  // A fresh backup is taught its band by the primary itself (#945): the primary sees the admin's new entry in
  // the band's host list and invites the still band-less host - the band code is the proof, checked with the
  // primary (its roster route is code-gated), and the invite names the host that must be us.
  const acceptJoinInvite = joinBandInvite({
    selfHostId: hostId,
    selfUrl,
    activeWorkspaceId: () => workspaceHardware.getActiveWorkspaceId(),
    // The rule (confirm the code with the primary, then ask who it is) is sync-host's; the pinned requests are Node's.
    verifyWithPrimary: createVerifyWithPrimary({
      post: (url, body, fingerprint) => postJsonToHost(url, body, fingerprint, 3_000),
      get: (url, fingerprint) => getFromHost(url, fingerprint, 3_000),
    }),
    ensureLocalDb: async (workspaceId) => void (await makeLocalBandDb(database, workspaceId)),
    activate: (workspaceId) => workspaceHardware.activate(workspaceId),
    store: bootstrapStore,
    now: () => Date.now(),
  })
  // Who a host is (host backup, #914): the stage app asks its *own* host to look up the address the admin
  // typed, so the page never has to trust a certificate it does not know yet - in the browser that would be
  // CORS, in the app a missing pin (#945).
  ownRoutes([
    {
      method: 'GET',
      pattern: '/host/look-up',
      handle: async (request) => {
        const parsed = HostLookupQuerySchema.safeParse(request.query)
        if (!parsed.success) return { status: 400, body: { status: 'error', message: 'An https host address is needed' } }
        // A host the admin named, not yet trusted: no fingerprint to check it against.
        const host = await lookUpHost(parsed.data.address, (url) => getFromHost(url, undefined, 3_000))
        return host ? { status: 200, body: host } : { status: 502, body: { status: 'error', message: 'That address does not answer as a Host' } }
      },
    },
  ])

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
  // The bands this host holds (#962): founding, listing, deleting, renaming, the access code, the master mode and the
  // Device Ledger's block/remove - the rules are sync-host's, the storage is the laptop's database host.
  const bands = createBandCatalog({
    store: createLaptopBandStore({
      database,
      accountsFor,
      isAdminOfAnyBand: (username, password) => isAnyBandAdmin(undefined, username, password),
      checkAdmin: (workspaceId, username, password) => checkBandAdmin(workspaceId, username, password),
    }),
    isSelfRequest: (address) => address !== undefined && isLoopback(address),
  })

  // The routes every host answers the same way - one table in sync-host, shared with the tablet's app (#949).
  const sharedDeps: HostRoutesDeps = {
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
      bands,
      channels,
      // Spoken announcements (#63): the routes are sync-host's; the engine - Piper and its voice files - is this machine's.
      speech: {
        pluginInstalled: () => registry.get(pluginIdProviding(CAPABILITIES.speechSynthesis) ?? '') !== undefined,
        normalise: PiperSpeech.normalise,
        speak: (text, voice, speed) => hostSpeech.speak(text, voice, speed),
        voices: {
          list: () => hostVoices.list(hostSpeech.piperInstalled()),
          license: (key) => hostVoices.license(key),
          install: (key) => hostVoices.install(key),
        },
        log: { info: (meta, message) => app.log.info(meta, message), error: (meta, message) => app.log.error(meta, message) },
      },
      // Song look-up (#546): the routes are sync-host's; the providers (a catalogue API, a scraped page) and the band's add-on check are this machine's.
      lookup: {
        search: (provider, query) => lookupRegistry.search(provider, query),
        fetchDetail: (provider, resultId) => lookupRegistry.fetchDetail(provider, resultId),
        refusal: lookupRefusal,
        errorBody: lookupErrorBody,
        log: { error: (meta, message) => app.log.error(meta, message) },
      },
      capabilities: () => hostCapabilities(runners),
      log: (message, meta) => app.log.info(meta, message),
  }

  // OSC devices (#484): host and port are the device's transport config for the Host
  // (Bühnentechnik), in the band whose hardware this host serves.
  setOscTargetResolver(async (logicalDeviceId) => {
    const workspaceId = workspaceHardware.getActiveWorkspaceId()
    if (!workspaceId || !logicalDeviceId) return null
    // Stored under this host's id; a config made before ids (#964) is still under the legacy word.
    const read = (owner: string) => getDoc<DatabaseDoc>(database, workspaceDbName(workspaceId), `device-transport-config:${owner}:${logicalDeviceId}`)
    return oscTargetFromConfig((await read(hostId)) ?? (await read(LEGACY_HOST_TARGET)))
  })

  async function checkBandAdmin(workspaceId: string, username: string, password: string, remoteAddress?: string): Promise<boolean> {
    if (!username.startsWith(`${workspaceDbName(workspaceId)}-`)) {
      app.log.warn({ workspaceId, username, remoteAddress }, 'Admin login for another band refused')
      return false
    }
    if (adminLoginThrottle.lockedForSeconds(username) > 0) return false
    const ctx = await accountsFor(workspaceId).login(basicHeader(username, password))
    if (ctx?.roles.includes('admin')) {
      adminLoginThrottle.recordSuccess(username)
      return true
    }
    if (adminLoginThrottle.recordFailure(username)) {
      app.log.warn({ workspaceId, username, remoteAddress }, 'Too many wrong admin logins - locked out temporarily')
    }
    return false
  }
  type PinCheck = { ok: true } | { ok: false; retryAfterSeconds?: number }
  async function checkAdminPin(remoteAddress: string | undefined, workspaceId: string, profileId: string, pin: string): Promise<PinCheck> {
    const answer = await bandJoinFor(workspaceId).verifyPin({ profileId, pin })
    if (answer.status === 200) return { ok: true }
    if (answer.status === 429) return { ok: false, retryAfterSeconds: (answer.body as { retryAfterSeconds: number }).retryAfterSeconds }
    if (pinThrottle.lockedForSeconds(`${workspaceId}:${profileId}`) > 0) {
      app.log.warn({ workspaceId, profileId, remoteAddress }, 'Too many wrong admin PINs - locked out temporarily')
    }
    return { ok: false }
  }

  /** 429 with how long to wait when locked, otherwise the plain 403 for a wrong proof. */
  function rejectPin(check: { ok: false; retryAfterSeconds?: number }, forbiddenMessage: string): HostRouteResponse {
    if (check.retryAfterSeconds) {
      return { status: 429, headers: { 'Retry-After': String(check.retryAfterSeconds) }, body: { status: 'error', message: 'Too many wrong PINs - try again later', retryAfterSeconds: check.retryAfterSeconds } }
    }
    return { status: 403, body: { status: 'error', message: forbiddenMessage } }
  }


  // The plugins and add-ons this host keeps and runs, as a route table of the Node shell (#964, step 2).
  const decoded = (value: string | undefined) => decodeURIComponent(value ?? '')
  const notBandAdmin = { status: 403, body: { status: 'error', message: 'Only an admin of this band manages add-ons' } }
  ownRoutes([
    { method: 'GET', pattern: '/plugins', handle: async () => ({ status: 200, body: registry.list() }) },
    // #101's Host mirror: whatever pluginSync.ts's downloadMissingBundles already cached to disk, served back out to any tablet on the LAN.
    {
      method: 'GET',
      pattern: '/plugins/:id/client.js',
      handle: async (request) => {
        const id = decoded(request.params.id)
        if (!isSafePluginId(id)) return { status: 400, body: { status: 'error', message: 'Invalid plugin id' } }
        const bundle = await readPluginBundle(id)
        if (bundle === null) return { status: 404, body: { status: 'error', message: 'No client bundle cached for this plugin' } }
        return { status: 200, binary: { data: new Uint8Array(bundle), contentType: 'application/javascript' } }
      },
    },
    // Add-ons from their own repositories (docs/32 §12, #852): the host keeps each version's files, checked against their SHA-256, and the
    // devices load them from here - never from the internet.
    {
      method: 'GET',
      pattern: '/addons/:id/:version/:file',
      handle: async (request) => {
        const file = decoded(request.params.file)
        const path = addonFilePath(addonRoot(), decoded(request.params.id), decoded(request.params.version), file)
        if (!path) return { status: 400, body: { status: 'error', message: 'Invalid add-on file' } }
        const data = await readFile(path).catch(() => null)
        if (data === null) return { status: 404, body: { status: 'error', message: 'No such add-on file kept' } }
        const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.json') ? 'application/json' : 'application/octet-stream'
        // A version's files never change - only a new version does.
        return { status: 200, headers: { 'cache-control': 'public, max-age=31536000, immutable' }, binary: { data: new Uint8Array(data), contentType } }
      },
    },
    /** What the admin sees before installing: the latest release's manifest, publisher, source, size. */
    {
      method: 'POST',
      pattern: '/workspaces/:workspaceId/addons/preview',
      handle: async (request) => {
        if (!(await isBandAdmin(decoded(request.params.workspaceId), request.authorization))) return notBandAdmin
        const parsed = AddonPreviewRequestSchema.safeParse(request.body)
        if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
        try {
          const { preview } = await previewAddon(parsed.data.repository, { apiBase: process.env.STAGEBOARD_GITHUB_API })
          // What this device lacks to run the add-on's jobs (#962): the admin sees it before installing.
          return { status: 200, body: { ...preview, hostNeeds: addonHostNeeds(preview.manifest) } }
        } catch (err) {
          if (err instanceof AddonError) return { status: 422, body: { status: 'error', code: err.code, message: err.message } }
          throw err
        }
      },
    },
    /** Downloads and checks the latest release and keeps it (with the version before it, for rollback). `expectedVersion`: what the admin saw
     * in the preview - a newer release in between is refused rather than installed unseen. The band's documents are written by the admin's device. */
    {
      method: 'POST',
      pattern: '/workspaces/:workspaceId/addons/install',
      handle: async (request) => {
        const workspaceId = decoded(request.params.workspaceId)
        if (!(await isBandAdmin(workspaceId, request.authorization))) return notBandAdmin
        const parsed = AddonInstallRequestSchema.safeParse(request.body)
        if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
        const deps = { apiBase: process.env.STAGEBOARD_GITHUB_API }
        try {
          const { preview, release } = await previewAddon(parsed.data.repository, deps)
          if (preview.manifest.version !== parsed.data.expectedVersion) {
            return { status: 409, body: { status: 'error', code: 'version-changed', message: `The repository now offers ${preview.manifest.version}`, version: preview.manifest.version } }
          }
          const needs = addonHostNeeds(preview.manifest)
          if (needs) {
            app.log.warn({ workspaceId, addon: preview.manifest.id, needs }, 'Add-on refused - this device cannot run its jobs')
            return addonRefusal(preview.manifest.id, needs)
          }
          await installAddonVersion(preview.manifest, release, addonRoot(), deps)
          const keep = [preview.manifest.version, ...(parsed.data.previousVersion ? [parsed.data.previousVersion] : [])]
          await pruneAddonVersions(addonRoot(), preview.manifest.id, keep)
          app.log.info({ workspaceId, addon: preview.manifest.id, version: preview.manifest.version, repository: preview.repository }, 'Add-on version kept')
          return { status: 200, body: { ...preview, keptVersions: keep } }
        } catch (err) {
          if (err instanceof AddonError) {
            app.log.warn({ workspaceId, repository: parsed.data.repository, code: err.code, detail: err.message }, 'Add-on install refused')
            return { status: 422, body: { status: 'error', code: err.code, message: err.message } }
          }
          throw err
        }
      },
    },
    {
      method: 'POST',
      pattern: '/plugins/:name/trigger',
      handle: async (request) => {
        const name = decoded(request.params.name)
        const parsed = ShowControlEventSchema.safeParse(request.body)
        if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
        // scheduledAt is a Gateway-only concern (see the schema doc comment) - the plugin itself only ever sees type/payload, same shape as before #31.
        const { scheduledAt, ...event } = parsed.data
        if (scheduledAt !== undefined) {
          const delayMs = scheduledAt - Date.now()
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
        const result = await registry.trigger(name, event)
        if (result === null) return { status: 404, body: { status: 'error', message: `Unknown plugin: ${name}` } }
        return { status: 200, body: result }
      },
    },
  ])

  const lookupRegistry = new LookupRegistry()

  /** Ultimate Guitar only for a band that installed its add-on (#546) - the app sends its band as
   * `workspace`. Other providers (MusicBrainz) need nothing. Returns the refusal, or null. */
  async function lookupRefusal(provider: string, workspace: string | undefined): Promise<HostMessage | null> {
    // The manifest says which provider answers only bands that installed it (`lookup.requiresInstall`) - this route knows no provider by name.
    const addon = LOOKUP_ADDONS.find((info) => info.id === provider)
    if (!addon?.lookup?.requiresInstall) return null
    if (!workspace || !/^[a-z0-9_-]+$/i.test(workspace)) return hostMessage('ug.bandMissing')
    const installed = await bandHasAddon(database, workspace, addon.pluginId).catch(() => false)
    return installed ? null : hostMessage('ug.addonMissing')
  }


  // An add-on's method, answered by its work script in a sandbox on this device (docs/36 §3, #964). The add-on must be installed for the band; what
  // comes back is the add-on's own answer or its own error - this route knows no add-on's domain.
  ownRoutes([
    {
      method: 'POST',
      pattern: '/addons/:id/methods/:method',
      handle: async (request) => {
        const id = decoded(request.params.id)
        const method = decoded(request.params.method)
        const workspace = request.query.workspace
        if (!workspace || !/^[a-z0-9_-]+$/i.test(workspace)) return { status: 400, body: { status: 'error', message: 'Missing or invalid workspace' } }
        if (!addonMethods.has(id)) return { status: 404, body: { ok: false, error: { code: 'addon.unknown', message: `No add-on "${id}" on this host`, params: { addon: id } } } }
        // Only what the add-on marked for devices: a method that sends a packet (OSC), runs Demucs or fetches audio is the host's own business -
        // without this anyone on the network could make this host send UDP anywhere or start a program (found in review, 2026-11-21).
        const declared = addonMethods.contributes(id)?.methods
        if (!declared || !Object.prototype.hasOwnProperty.call(declared, method) || declared[method]!.callableByDevices !== true) {
          return { status: 403, body: { ok: false, error: { code: 'method.not-callable', message: `The method "${method}" of "${id}" is not offered to devices.`, params: { addon: id, method } } } }
        }
        if (!(await bandHasAddon(database, workspace, id).catch(() => false))) return { status: 403, body: { status: 'error', ...hostMessage('addon.notInstalled', { addon: id }) } }
        return { status: 200, body: await addonMethods.call(id, method, request.body ?? {}) }
      },
    },
  ])

  // Provisions a brand-new workspace: its database, `_security` doc, roster validation doc, and
  // the founding device's own personal account (see per-person-accounts follow-up -
  // every roster member gets their own account, the founder is just the first one, auto-admin).
  // Who may found a band (#364, Marco 2026-10-05): the first band on a fresh host anyone; every
  // further one only an admin of a band on this host (or the host machine itself).
  const adminProofThrottle = createPinThrottle()

  /** An admin login as proof for founding (any band's admin) - locked after 5 wrong tries per
   * account like the PIN routes, since an admin's anchor password is their 4-digit PIN. */
  async function isAnyBandAdmin(remoteAddress: string | undefined, username: string, password: string): Promise<boolean> {
    const key = `admin:${username}`
    if (adminProofThrottle.lockedForSeconds(key) > 0) return false
    // The login names its band (`stageboard-<band>-<profile>[~<device>]`): the band whose database name it extends.
    const band = (await listDbs(database)).find((db) => db.startsWith('stageboard-') && username.startsWith(`${db}-`))
    const ctx = band ? await accountsFor(band.slice('stageboard-'.length)).login(basicHeader(username, password)) : null
    if (ctx?.roles.includes('admin')) {
      adminProofThrottle.recordSuccess(key)
      return true
    }
    if (adminProofThrottle.recordFailure(key)) app.log.warn({ username, remoteAddress }, 'Too many wrong admin logins - locked out temporarily')
    return false
  }

  // Makes this box's hardware (plugin sync, Discovery Mode's MIDI watcher) serve `workspaceId`
  // instead of whichever workspace was previously active - the runtime replacement for having
  // to kill the process and restart it with a different STAGEBOARD_WORKSPACE env var, for the
  // real case of one Host serving two of Marco's own bands on different days, never at
  // the same time (see workspaceHardwareController.ts).
  ownRoutes([
    {
      method: 'POST',
      pattern: '/workspaces/:workspaceId/activate-hardware',
      handle: async (request) => {
        const workspaceId = decodeURIComponent(request.params.workspaceId ?? '')
        const parsed = ActivateWorkspaceHardwareRequestSchema.safeParse(request.body)
        if (!parsed.success) return { status: 400, body: { status: 'error', message: parsed.error.issues[0]?.message } }
        // Opening proof: an admin of the workspace being activated, checked against *that* workspace's own roster and PIN (verifyAdminPin) - an
        // admin of some other workspace cannot satisfy it; the flat 'admin' database role never decides this.
        const { opening, closing } = parsed.data
        const openingCheck = await checkAdminPin(request.remoteAddress, workspaceId, opening.profileId, opening.pin)
        if (!openingCheck.ok) return rejectPin(openingCheck, 'Not this workspace\'s admin')
        // Closing proof: only when some *other* workspace is active on this box - the caller may interrupt what is live right now. Without it,
        // anyone who merely knows the opening band's PIN could kill a different band's live show.
        const currentlyActive = workspaceHardware.getActiveWorkspaceId()
        if (currentlyActive && currentlyActive !== workspaceId) {
          if (!closing) return { status: 400, body: { status: 'error', message: `Admin proof for the currently active workspace (${currentlyActive}) is required to switch away from it` } }
          const closingCheck = await checkAdminPin(request.remoteAddress, currentlyActive, closing.profileId, closing.pin)
          if (!closingCheck.ok) return rejectPin(closingCheck, 'Not the currently active workspace\'s admin')
        }
        await workspaceHardware.activate(workspaceId)
        return { status: 200, body: { status: 'ok' } }
      },
    },
  ])


  // Which workspace (if any) this specific box's hardware currently serves - not scoped under
  // /workspaces/:workspaceId since it describes the host, not a workspace, and needs no auth
  // for the same reason /host/info needs none: not new information beyond what's already
  // observable on the LAN.
  // The Host's backups (#363, Marco 2026-10-08): targets chosen in the app (System →
  // Backup), run by the host itself - backup.ts. Admin of the band this host serves.
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
  async function activeBandAdmin(remoteAddress: string | undefined, body: { adminUsername: string; adminPassword: string }): Promise<HostRouteResponse | null> {
    const workspaceId = workspaceHardware.getActiveWorkspaceId()
    if (!workspaceId) return { status: 409, body: { status: 'error', ...hostMessage('band.noneActive') } }
    if (!(await checkBandAdmin(workspaceId, body.adminUsername, body.adminPassword, remoteAddress))) {
      app.log.warn({ workspaceId, remoteAddress }, 'Server setting refused: not this band\'s admin')
      return { status: 403, body: { status: 'error', ...hostMessage('band.activeAdminOnly') } }
    }
    return null
  }
  ownRoutes(hostSettingsRoutes({ backups, activeBandAdmin, measureInputs, calibrationRuns, log: app.log }))

  // 2026-09-02 fourth follow-up, at Marco's explicit request: consolidates the PWA, this API,
  // and the database onto this one origin, so a new device only ever has to accept one self-signed
  // certificate exception - browsers trust per *origin* (scheme+host+port), not per-certificate,
  // so serving all three from three different ports (Vite, Fastify, the database) meant every new
  // tablet needed up to three separate manual "trotzdem fortfahren" taps (docs/03 section 0a).
  //
  // Pure passthrough proxy, not a real integration: whatever Basic Auth header the client (a
  // real PouchDB instance, using that specific person's own account) already sends
  // travels straight through to real the database unmodified - this host's own trusted admin
  // `database` credentials above are never injected here, and the database itself still does every bit
  // of the actual authentication/authorization exactly as if the client had connected to it
  // directly. `stage-pwa`'s `workspaceDb.ts` now builds its remote database URL from this
  // server's own origin plus this `/db` prefix (`VITE_HOST_URL`) instead of a separate
  // `VITE_DB_URL` pointing at the database's own port - one address to configure, not two.
  // The guard is the one every host has (`guardBandDb`, #964 step 2). A laptop hosts and serves every band in its database, so it gives
  // no `servesBand`/`serving`: only the account check and the lock after wrong logins (#396) apply here today.
  // The laptop answers through the same pipeline as the tablet (#964 step 2): the shared routes, the Node shell's own, the live streams,
  // and the band databases behind the guard every host has. A laptop hosts and serves every band in its database, so it gives no
  // `servesBand` and serves always: only the account check and the lock after wrong logins (#396) apply to `/db` here today. The
  // database host checks the login itself.
  const hostDeps: HostRequestDeps = {
    ...sharedDeps,
    serving: sharedDeps.serving ?? (() => true),
    port,
    // The laptop's own `/host/info` is in its table (it reads the address fresh); this is the tablet's fallback.
    address: null,
    certFingerprint: CERT_FINGERPRINT ?? '',
    state: () => ({ epoch: hostEpoch, active: true, outdated: false, priority: null }),
    ownRoutes: nodeRoutes,
    stream: streamOf,
    loginThrottle: adminLoginThrottle,
    ...(options.databaseHost ? { database: laptopDatabase(options.databaseHost) } : {}),
  }
  registerHostPipeline(app, (request) => answerHostRequest(request, hostDeps))

  // Serves stage-pwa's `vite build` output, if present - graceful fallback, same pattern as the
  // TLS certs above (see `certFile`/`keyFile`): without a build in place, this registers
  // nothing, and `npm run dev` in stage-pwa (Vite's own dev server, still its own origin) keeps
  // working exactly as before for day-to-day iteration. Only relevant for testing "as a real
  // device would see it" - one origin, one cert exception - or an actual gig. No SPA-fallback
  // routing needed: the app has no client-side URL router at all, just one `index.html` and
  // in-memory React state, so `@fastify/static`'s default file-or-404 behavior is already
  // exactly right - `/` is the only path anything ever actually requests.
  // The native Android app (#348), built by scripts/build-android-app.sh next to the host's data.
  ownRoutes(appRoutes(appDir()))

  const pwaDist = fileURLToPath(new URL('../../stage-pwa/dist', import.meta.url))
  if (existsSync(pwaDist)) {
    // Only the files the build has (no wildcard route): everything else is the host pipeline's.
    await app.register(fastifyStatic, { root: pwaDist, wildcard: false })
  }

  return { app, registry, lookupRegistry, database, workspaceHardware, pluginLog, backups, hostLease, replication, audioMirror, catchUp, channels }
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
    // For measuring only (tools/soak): another storage setup, e.g. '{"auto_compaction":false,"revs_limit":50}'.
    ...(process.env.STAGEBOARD_DB_STORAGE ? { storage: JSON.parse(process.env.STAGEBOARD_DB_STORAGE) } : {}),
  })
  process.env.STAGEBOARD_DB_URL = builtinDb.url
  const { app, lookupRegistry, workspaceHardware, pluginLog, database, backups, hostLease, replication, audioMirror, catchUp, channels } = await buildApp({ databaseHost: builtinDb.handle })
  app.log.info({ url: builtinDb.url }, 'Built-in database host')
  // Scheduled backups (daily time, USB medium plugged in) - checked every 30 s.
  backups.start()

  try {
    // Validator rules added after a band was founded (protected dashboard templates, #16) reach
    // its database here. A failure must not keep the host from starting.
    try {
      const updated = await updateRosterValidators(database, (db, err) => app.log.error({ err, db }, 'Could not update the roster validator of this band'))
      if (updated.length > 0) app.log.info({ databases: updated }, 'Roster validator updated')
    } catch (err) {
      app.log.error({ err }, 'Could not update roster validators')
    }

    // Which plugins run is not configured here: the band installs them in the PWA, and the
    // installation documents replicate to this host over the database (docs/01, mesh).
    //
    // 2026-09-02 fourteenth follow-up, at Marco's explicit request, after finding a phantom
    // empty "band-a" workspace kept reappearing in "Verfügbare Bands" no matter how often he
    // deleted it: this used to default to workspaceId 'band-a' when STAGEBOARD_WORKSPACE
    // wasn't set - a leftover from before the WiFi-style redesign, when a Host
    // belonged to exactly one fixed band. `start()` (pluginSync.ts) calls `ensureDb()`
    // unconditionally, which *creates* that database if it's missing - so every host
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
          const devices = channels.pushOscIn(workspaceId, { ...message, at: Date.now() })
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
      const redirectHost = createServer((request, response) => {
        const host = (request.headers.host ?? 'stageboard.local').split(':')[0]
        response.writeHead(301, { Location: `https://${host}${request.url ?? '/'}` })
        response.end()
      })
      redirectHost.on('error', (err) => {
        app.log.warn({ err }, 'Could not start the port-80 HTTP->HTTPS redirect listener - the main HTTPS server is unaffected')
      })
      redirectHost.listen(80, '0.0.0.0')
      app.addHook('onClose', async () => {
        await new Promise<void>((resolve) => redirectHost.close(() => resolve()))
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
      // the responder retries on its own while the host already serves by raw IP.
      const mdns = startMdnsResponder({
        lanIp,
        hostname: mdnsHostname,
        port,
        // The name the native app lists this host under (#351).
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

// Only start the real host when this file is the process entrypoint (`tsx src/index.ts`
// or `node dist/index.js`) - not when it's imported, e.g. by index.test.ts for `buildApp()`.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
