import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import cors from '@fastify/cors'
import Fastify, { type FastifyInstance } from 'fastify'
import { ShowControlEventSchema } from 'shared-types'
import { LOOKUP_CATALOG } from './plugins/lookupCatalog.js'
import { LookupRegistry } from './plugins/lookupRegistry.js'
import { createPluginSync } from './plugins/pluginSync.js'
import { PluginRegistry } from './plugins/registry.js'

const certFile = fileURLToPath(new URL('../../../certs/dev-cert.pem', import.meta.url))
const keyFile = fileURLToPath(new URL('../../../certs/dev-key.pem', import.meta.url))

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
  const app: FastifyInstance =
    existsSync(certFile) && existsSync(keyFile)
      ? (Fastify({
          logger: true,
          https: { cert: readFileSync(certFile), key: readFileSync(keyFile) },
        }) as unknown as FastifyInstance)
      : Fastify({ logger: true })

  // Tablets fetch this cross-origin (their own dev-server or PWA origin, not this server's) -
  // same FRONTEND_ORIGIN convention as scripts/setup-couchdb.sh's CouchDB CORS setup.
  await app.register(cors, {
    origin: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').split(','),
  })

  app.get('/health', async () => ({ status: 'ok' }))

  const registry = new PluginRegistry()

  app.get('/plugins', async () => registry.list())

  app.post('/plugins/:name/trigger', async (request, reply) => {
    const { name } = request.params as { name: string }
    const parsed = ShowControlEventSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ status: 'error', message: parsed.error.issues[0]?.message })
    }

    const result = await registry.trigger(name, parsed.data)
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

  return { app, registry, lookupRegistry }
}

const port = Number(process.env.PORT ?? 3001)

async function main() {
  const { app, registry, lookupRegistry } = await buildApp()

  try {
    const pluginLog = {
      info: (msg: string, meta?: Record<string, unknown>) => app.log.info(meta ?? {}, msg),
      error: (msg: string, meta?: Record<string, unknown>) => app.log.error(meta ?? {}, msg),
    }

    // Which plugins run is not configured here: the band installs them in the PWA, and the
    // installation documents replicate to this server over CouchDB (docs/01, mesh).
    const sync = createPluginSync({
      couch: {
        url: process.env.COUCHDB_URL ?? 'http://localhost:5984',
        user: process.env.COUCHDB_USER ?? 'admin',
        password: process.env.COUCHDB_PASSWORD ?? 'admin',
      },
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
