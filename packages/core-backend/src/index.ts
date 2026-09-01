import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  CreateMemberRequestSchema,
  HealthReportSchema,
  JoinAsMemberRequestSchema,
  RemoveMemberRequestSchema,
  ResetMemberPasswordRequestSchema,
  SetMemberAdminRequestSchema,
  ShowControlEventSchema,
  WorkspaceDeleteRequestSchema,
  WorkspaceInviteRequestSchema,
  WorkspaceProvisionRequestSchema,
} from 'shared-types'
import { deleteAudioFile, isSafeAudioId, readAudioFile, writeAudioFile } from './audioStore.js'
import { allDocs, getDoc, userExists, verifyUser, type CouchConfig, type CouchDoc } from './couch.js'
import * as healthStore from './plugins/healthStore.js'
import { LOOKUP_CATALOG } from './plugins/lookupCatalog.js'
import { LookupRegistry } from './plugins/lookupRegistry.js'
import { createPluginSync } from './plugins/pluginSync.js'
import { PluginRegistry } from './plugins/registry.js'
import { createInvite, resolveInvite } from './inviteStore.js'
import {
  deprovisionMember,
  deprovisionWorkspace,
  generateMemberPassword,
  memberUsername,
  provisionMember,
  provisionWorkspace,
  resetMemberPassword,
  setMemberAdmin,
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

/** The roster as shown to a device mid-join (`POST /invites/:code/roster`, 2026-09-01 redesign)
 * - every profile, plus whether each one's CouchDB account already exists (`requiresPassword`),
 * so the joining device knows whether to prompt for a password or auto-provision on pick. */
async function readRoster(couch: CouchConfig, workspaceId: string) {
  const profiles = await allDocs<CouchDoc & { id?: string; name?: string; role?: string }>(couch, workspaceDbName(workspaceId), {
    startkey: PROFILE_ID_PREFIX,
    endkey: `${PROFILE_ID_PREFIX}￰`,
  })
  return Promise.all(
    profiles.map(async (profile) => ({
      profileId: profile.id!,
      name: profile.name!,
      role: profile.role!,
      requiresPassword: await userExists(couch, memberUsername(workspaceId, profile.id!)),
    })),
  )
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
      const credentials = await provisionWorkspace(couch, parsed.data.workspaceId, parsed.data.founderId)
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

  // Resets an already-provisioned member's password to a fresh random one (2026-08-31,
  // BandManagementView.tsx's "Einladen" - the admin "forgot/never knew it" escape hatch).
  // No last-admin check needed - unlike remove/demote, a password reset can't reduce the
  // admin count.
  app.post('/workspaces/:workspaceId/members/:profileId/reset-password', async (request, reply) => {
    const { workspaceId, profileId } = request.params as { workspaceId: string; profileId: string }
    const parsed = ResetMemberPasswordRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await verifyAdmin(couch, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    const credentials = await resetMemberPassword(couch, workspaceId, profileId)
    return reply.status(200).send(credentials)
  })

  // Mints a short-lived, workspace-level join code (2026-09-01 redesign - see
  // WorkspaceInviteRequestSchema's doc comment) - not tied to any one person, so only a device
  // that holds *some* admin account for this workspace can mint one. The caller proves that by
  // including its own username/password, verified directly against CouchDB (verifyAdmin)
  // rather than trusting a claimed identity.
  app.post('/workspaces/:workspaceId/invite', async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string }
    const parsed = WorkspaceInviteRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    if (!(await verifyAdmin(couch, parsed.data.adminUsername, parsed.data.adminPassword))) {
      return reply.status(403).send({ status: 'error', message: 'Not this workspace\'s admin' })
    }

    const invite = createInvite(workspaceId, parsed.data.workspaceName)
    return reply.status(201).send(invite)
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

  // Public, no auth (see #21, 2026-09-01 redesign) - anyone holding the code can look up the
  // roster, same trust level the raw workspace password already had. Its only protection is
  // the short TTL in inviteStore.ts. Hands back names/roles only, never credentials - the
  // joining device still has to pick who it is (POST /invites/:code/join/:profileId below)
  // before it gets anything it could actually sync with.
  app.post('/invites/:code/roster', async (request, reply) => {
    const { code } = request.params as { code: string }
    const resolved = resolveInvite(code)
    if (!resolved) {
      return reply.status(404).send({ status: 'error', message: 'Unknown or expired invite code' })
    }

    const members = await readRoster(couch, resolved.workspaceId)
    return reply.status(200).send({ workspaceId: resolved.workspaceId, workspaceName: resolved.workspaceName, members })
  })

  // Public, no auth - the second half of the self-service join (2026-09-01 redesign). Still
  // requires the code to be valid/unexpired (re-resolved here, not just trusted from an earlier
  // /roster call), then either verifies the supplied password against an already-provisioned
  // account, or auto-provisions a brand-new one (never as admin - self-service join can't grant
  // that) when none exists yet.
  app.post('/invites/:code/join/:profileId', async (request, reply) => {
    const { code, profileId } = request.params as { code: string; profileId: string }
    const parsed = JoinAsMemberRequestSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    const resolved = resolveInvite(code)
    if (!resolved) {
      return reply.status(404).send({ status: 'error', message: 'Unknown or expired invite code' })
    }
    const { workspaceId } = resolved

    const profile = await getDoc(couch, workspaceDbName(workspaceId), `${PROFILE_ID_PREFIX}${profileId}`)
    if (!profile) {
      return reply.status(404).send({ status: 'error', message: 'Unknown roster member' })
    }

    const username = memberUsername(workspaceId, profileId)
    if (await userExists(couch, username)) {
      if (!parsed.data.password) {
        return reply.status(400).send({ status: 'error', message: 'Password required' })
      }
      const verified = await verifyUser(couch, username, parsed.data.password)
      if (!verified) {
        return reply.status(403).send({ status: 'error', message: 'Wrong password' })
      }
      return reply.status(200).send({ username, password: parsed.data.password, isAdmin: verified.roles.includes('admin') })
    }

    const credentials = await provisionMember(couch, workspaceId, profileId, generateMemberPassword(), false)
    return reply.status(201).send({ ...credentials, isAdmin: false })
  })

  return { app, registry, lookupRegistry, couch }
}

const port = Number(process.env.PORT ?? 3001)

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
