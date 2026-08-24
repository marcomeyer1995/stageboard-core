import Fastify from 'fastify'
import { ShowControlEventSchema, SongSchema, type Song } from 'shared-types'
import { createMockMixerPlugin } from './plugins/mockMixerPlugin.js'
import { PluginRegistry } from './plugins/registry.js'

const app = Fastify({ logger: true })

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
  await registry.register(createMockMixerPlugin(), { log: pluginLog })
  await app.listen({ port, host: '0.0.0.0' })
}

main().catch((err) => {
  app.log.error(err)
  process.exit(1)
})
