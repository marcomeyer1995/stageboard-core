import cors from '@fastify/cors'
import Fastify from 'fastify'
import { ShowControlEventSchema, SongSchema, type Song } from 'shared-types'
import { createPluginSync } from './plugins/pluginSync.js'
import { PluginRegistry } from './plugins/registry.js'

const app = Fastify({ logger: true })

// Tablets fetch this cross-origin (their own dev-server or PWA origin, not this server's) -
// same FRONTEND_ORIGIN convention as scripts/setup-couchdb.sh's CouchDB CORS setup.
await app.register(cors, {
  origin: (process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173').split(','),
})

app.get('/health', async () => ({ status: 'ok' }))

const dummySongs: Song[] = [
  SongSchema.parse({
    id: 'song-1',
    title: 'Sweet Home Chicago',
    bpm: 118,
    chordProContent: '[E7] Come on baby [A7] don\'t you wanna go',
    timecodes: [{ timeMs: 0, label: 'Verse 1' }],
  }),
]

app.get('/songs', async () => dummySongs)

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

const port = Number(process.env.PORT ?? 3001)

async function main() {
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

  await app.listen({ port, host: '0.0.0.0' })
}

main().catch((err) => {
  app.log.error(err)
  process.exit(1)
})
