import Fastify from 'fastify'
import { SongSchema, type Song } from 'shared-types'

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

const port = Number(process.env.PORT ?? 3001)

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err)
  process.exit(1)
})
