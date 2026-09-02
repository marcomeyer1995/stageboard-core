import { createSocket as createDgramSocket, type Socket } from 'node:dgram'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import httpProxy from '@fastify/http-proxy'
import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyInstance } from 'fastify'
import mdnsFactory from 'multicast-dns'
import {
  ActivateProfileRequestSchema,
  CreateMemberRequestSchema,
  HealthReportSchema,
  GetAccessCodeRequestSchema,
  JoinAsMemberRequestSchema,
  RemoveMemberRequestSchema,
  ResetMemberPasswordRequestSchema,
  RosterRequestSchema,
  RotateAccessCodeRequestSchema,
  SetMemberAdminRequestSchema,
  SetOwnPinRequestSchema,
  ShowControlEventSchema,
  WorkspaceDeleteRequestSchema,
  WorkspaceProvisionRequestSchema,
} from 'shared-types'
import { deleteAudioFile, isSafeAudioId, readAudioFile, writeAudioFile } from './audioStore.js'
import { allDocs, getDoc, userExists, verifyUser, type CouchConfig, type CouchDoc } from './couch.js'
import * as healthStore from './plugins/healthStore.js'
import { LOOKUP_CATALOG } from './plugins/lookupCatalog.js'
import { LookupRegistry } from './plugins/lookupRegistry.js'
import { createPluginSync } from './plugins/pluginSync.js'
import { PluginRegistry } from './plugins/registry.js'
import {
  deprovisionMember,
  deprovisionWorkspace,
  generateMemberPassword,
  getOrCreateAccessCode,
  listWorkspaces,
  memberUsername,
  provisionMember,
  provisionWorkspace,
  resetAdminPin,
  resetMemberPassword,
  rotateAccessCode,
  setMemberAdmin,
  setMemberPassword,
  workspaceDbName,
  WorkspaceAlreadyProvisionedError,
} from './workspaceProvisioning.js'

const certFile = fileURLToPath(new URL('../../../certs/dev-cert.pem', import.meta.url))
const keyFile = fileURLToPath(new URL('../../../certs/dev-key.pem', import.meta.url))

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
 * - **Non-admin target**: no password check, ever - `password` is ignored entirely. Already
 *   provisioned or not, this always succeeds, silently (re)issuing that account's password
 *   fresh every single time (`resetMemberPassword`/`provisionMember`, both using a long,
 *   never-typed random value - nobody, including whoever created the roster entry, ever sets
 *   or knows a non-admin's password).
 * - **Admin target, account exists**: `password` must equal either that admin's own current
 *   password (their self-assigned PIN, `verifyUser`) *or* `accessCodeSuffix` - the workspace's
 *   own standing access code's last 4 digits, which always works for *any* admin account here.
 *   The suffix match triggers a silent reissue (`resetMemberPassword`) rather than treating the
 *   admin's real password as "changed to the suffix" - the device ends up with valid working
 *   credentials either way, but the account isn't left with a widely-known 4-digit password.
 * - **Admin target, no account yet**: a valid 4-digit `password` becomes that admin's own
 *   initial self-assigned PIN (`provisionMember`). In practice every roster entry already gets
 *   an account the moment it's created (`provisionMember`/`provisionWorkspace`), admin or not,
 *   so this only exists as a defensive fallback, not a path real traffic is expected to hit.
 */
async function resolveOutcome(
  couch: CouchConfig,
  workspaceId: string,
  profileId: string,
  password: string | undefined,
  accessCodeSuffix: string,
): Promise<ResolveOutcome> {
  const profile = await getDoc<CouchDoc & { stageRoles?: string[] }>(couch, workspaceDbName(workspaceId), `${PROFILE_ID_PREFIX}${profileId}`)
  if (!profile) {
    return { ok: false, code: 404, message: 'Unknown roster member' }
  }
  const profileIsAdmin = (profile.stageRoles ?? []).includes('admin')
  const username = memberUsername(workspaceId, profileId)
  const exists = await userExists(couch, username)

  if (!profileIsAdmin) {
    const credentials = exists
      ? await resetMemberPassword(couch, workspaceId, profileId)
      : await provisionMember(couch, workspaceId, profileId, generateMemberPassword(), false)
    return { ok: true, code: exists ? 200 : 201, body: { ...credentials, isAdmin: false } }
  }

  if (!exists) {
    if (!password || !/^\d{4}$/.test(password)) {
      return { ok: false, code: 400, message: 'Admin accounts need a 4-digit PIN' }
    }
    const credentials = await provisionMember(couch, workspaceId, profileId, password, true)
    return { ok: true, code: 201, body: { ...credentials, isAdmin: true } }
  }

  if (!password) {
    return { ok: false, code: 403, message: 'Admin accounts require a code' }
  }
  if (password === accessCodeSuffix) {
    const credentials = await resetMemberPassword(couch, workspaceId, profileId)
    return { ok: true, code: 200, body: { ...credentials, isAdmin: true } }
  }
  const verified = await verifyUser(couch, username, password)
  if (!verified) {
    return { ok: false, code: 403, message: 'Wrong code' }
  }
  return { ok: true, code: 200, body: { username, password, isAdmin: verified.roles.includes('admin') } }
}

/**
 * Wires up the Fastify instance and every route, with fresh, empty plugin registries - no
 * CouchDB sync, no LOOKUP_CATALOG registration, no `listen()`. Split out from `main()` so
 * tests can exercise real routes via `.inject()` without any of that I/O; `main()` is the
 * only caller that goes on to populate the registries and actually start the server.
 */
export async function buildApp() {
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

  const app: FastifyInstance =
    existsSync(certFile) && existsSync(keyFile)
      ? (Fastify({
          logger: true,
          bodyLimit,
          https: { cert: readFileSync(certFile), key: readFileSync(keyFile) },
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
    origin: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').split(','),
    methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
  })

  app.get('/health', async () => ({ status: 'ok' }))

  // The NTP-style "burst handshake" target (docs/00 §4, #31): clients hit this repeatedly and
  // keep the lowest-RTT sample's offset (see stage-pwa's clockSync.ts) - a single Date.now()
  // read is all a client needs, no session/state on this end.
  app.get('/time', async () => ({ serverTime: Date.now() }))

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

    // hijack() hands the raw response fully to us - Fastify's normal send/serialize
    // lifecycle never runs for this request. We copy whatever it already queued (e.g. CORS
    // headers from the cors plugin's onRequest hook) so this stream keeps carrying them -
    // set individually rather than passed to writeHead(), which has no overload accepting an
    // arbitrary Record<string, ...> alongside a status code.
    reply.hijack()
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value)
    }
    reply.raw.setHeader('Content-Type', 'text/event-stream')
    reply.raw.setHeader('Cache-Control', 'no-cache')
    reply.raw.setHeader('Connection', 'keep-alive')
    reply.raw.writeHead(200)

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

  const registry = new PluginRegistry()

  app.get('/plugins', async () => registry.list())

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
      app.log.error(err)
      return reply.status(502).send({ status: 'error', message: err instanceof Error ? err.message : String(err) })
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
      app.log.error(err)
      return reply.status(502).send({ status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  })

  // Provisions a brand-new workspace: its database, `_security` doc, roster validation doc, and
  // the founding device's own personal CouchDB account (see per-person-accounts follow-up -
  // every roster member gets their own account, the founder is just the first one, auto-admin).
  app.post('/workspaces', async (request, reply) => {
    const parsed = WorkspaceProvisionRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    try {
      const credentials = await provisionWorkspace(couch, parsed.data.workspaceId, parsed.data.founderId, parsed.data.workspaceName)
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

    if (!(await verifyAdmin(couch, parsed.data.adminUsername, parsed.data.adminPassword))) {
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

    if (!(await verifyAdmin(couch, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    if (!parsed.data.isAdmin && (await countOtherAdmins(couch, workspaceId, profileId)) === 0) {
      return reply.status(400).send({ status: 'error', message: 'At least one admin must remain' })
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

    if (!(await verifyAdmin(couch, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    // Only actually blocks removing the sole remaining *admin* - deleting a plain member never
    // changes the admin count, so this only rejects when the target itself is that one admin.
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

    if (!(await verifyAdmin(couch, parsed.data.adminUsername, parsed.data.adminPassword))) {
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
  app.post('/workspaces/:workspaceId/members/:profileId/set-pin', async (request, reply) => {
    const { workspaceId, profileId } = request.params as { workspaceId: string; profileId: string }
    const parsed = SetOwnPinRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    const targetUsername = memberUsername(workspaceId, profileId)
    if (parsed.data.callerUsername !== targetUsername) {
      return reply.status(403).send({ status: 'error', message: 'Can only set your own PIN' })
    }
    const caller = await verifyUser(couch, parsed.data.callerUsername, parsed.data.callerPassword)
    if (!caller || !caller.roles.includes('admin')) {
      return reply.status(403).send({ status: 'error', message: 'Invalid credentials or not an admin account' })
    }

    const credentials = await setMemberPassword(couch, workspaceId, profileId, parsed.data.newPin)
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

    if (!(await verifyAdmin(couch, parsed.data.adminUsername, parsed.data.adminPassword))) {
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

    const result = await resolveOutcome(couch, workspaceId, profileId, parsed.data.password, accessCode.code.slice(-4))
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

    const accessCode = await getOrCreateAccessCode(couch, workspaceId, workspaceId)
    const result = await resolveOutcome(couch, workspaceId, profileId, parsed.data.password, accessCode.code.slice(-4))
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

    if (!(await verifyAdmin(couch, parsed.data.adminUsername, parsed.data.adminPassword))) {
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

    if (!(await verifyAdmin(couch, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    const code = await rotateAccessCode(couch, workspaceId)
    return reply.status(200).send({ code })
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
  })

  // Serves stage-pwa's `vite build` output, if present - graceful fallback, same pattern as the
  // TLS certs above (see `certFile`/`keyFile`): without a build in place, this registers
  // nothing, and `npm run dev` in stage-pwa (Vite's own dev server, still its own origin) keeps
  // working exactly as before for day-to-day iteration. Only relevant for testing "as a real
  // device would see it" - one origin, one cert exception - or an actual gig. No SPA-fallback
  // routing needed: the app has no client-side URL router at all, just one `index.html` and
  // in-memory React state, so `@fastify/static`'s default file-or-404 behavior is already
  // exactly right - `/` is the only path anything ever actually requests.
  const pwaDist = fileURLToPath(new URL('../../stage-pwa/dist', import.meta.url))
  if (existsSync(pwaDist)) {
    await app.register(fastifyStatic, { root: pwaDist })
  }

  return { app, registry, lookupRegistry, couch }
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

/** Builds and fully configures the UDP socket the mDNS responder above uses, rather than
 * letting `multicast-dns` create and configure its own - see that call site's doc comment for
 * why (in short: its own outgoing-interface selection isn't reliable on a machine with Docker's
 * virtual network interfaces present). Bind stays on the wildcard address (`0.0.0.0`, Node's
 * `dgram` default with no address argument) - binding to `lanIp` specifically instead, which
 * seems like the more obviously-correct choice, was tried first and silently breaks *receiving*
 * multicast traffic on Linux. `setMulticastInterface(lanIp)` is what actually pins outgoing
 * packets to the real interface. */
function createMdnsSocket(lanIp: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createDgramSocket({ type: 'udp4', reuseAddr: true })
    socket.once('error', reject)
    socket.bind(5353, () => {
      socket.removeListener('error', reject)
      socket.addMembership('224.0.0.251', lanIp)
      socket.setMulticastTTL(255)
      socket.setMulticastLoopback(true)
      socket.setMulticastInterface(lanIp)
      resolve(socket)
    })
  })
}

async function main() {
  const { app, registry, lookupRegistry, couch } = await buildApp()

  try {
    const pluginLog = {
      info: (msg: string, meta?: Record<string, unknown>) => app.log.info(meta ?? {}, msg),
      error: (msg: string, meta?: Record<string, unknown>) => app.log.error(meta ?? {}, msg),
    }

    // Which plugins run is not configured here: the band installs them in the PWA, and the
    // installation documents replicate to this server over CouchDB (docs/01, mesh).
    const sync = createPluginSync({
      couch,
      workspaceId: process.env.STAGEBOARD_WORKSPACE ?? 'band-a',
      registry,
      log: pluginLog,
    })
    app.addHook('onClose', async () => sync.stop())

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
    // actually active (`existsSync(certFile) && existsSync(keyFile)`) - with no TLS at all
    // there's nothing to redirect *to*. Binding port 80 needs the same privileged-port grant as
    // 443 (`setcap cap_net_bind_service` on node, docs/03) - if that's missing (e.g. a machine
    // that's only had 443 granted so far), this logs a warning and the main app on 443 keeps
    // working regardless; the redirect is a convenience, not a dependency. Registered (and the
    // mDNS block below) *before* `app.listen()` - Fastify forbids `addHook` once already
    // listening (found live: `FST_ERR_INSTANCE_ALREADY_LISTENING`), so both need to go first
    // even though neither actually depends on the HTTPS listener being up yet.
    if (existsSync(certFile) && existsSync(keyFile)) {
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
    // Builds its own socket (`createMdnsSocket` below) rather than letting `multicast-dns`
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
      const socket = await createMdnsSocket(lanIp)
      const mdns = mdnsFactory({ socket, bind: false })
      mdns.on('query', (query) => {
        if (query.questions.some((q) => q.type === 'A' && q.name === mdnsHostname)) {
          mdns.respond({ answers: [{ name: mdnsHostname, type: 'A', ttl: 120, data: lanIp }] })
        }
      })
      mdns.on('error', (err) => {
        app.log.warn({ err }, `Could not start the mDNS responder for ${mdnsHostname} - falling back to raw IP access`)
      })
      app.addHook('onClose', async () => {
        await new Promise<void>((resolve) => mdns.destroy(resolve))
      })
      app.log.info(`Advertising ${mdnsHostname} -> ${lanIp} via mDNS`)
    } else {
      app.log.warn('No LAN IP detected and LAN_IP not set - stageboard.local will not resolve, only the raw IP will work')
    }

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
