import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLookupAddonPlugin } from './lookupAddon.js'
import { createAddonMethods } from './addonMethods.js'

let server: Server
let baseUrl: string
let methods: ReturnType<typeof createAddonMethods>
const seen: { url: string; ua: string | undefined }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ url: req.url ?? '', ua: req.headers['user-agent'] })
    res.setHeader('Content-Type', 'application/json')
    if (req.url?.includes('recording/bad')) return void ((res.statusCode = 503), res.end('{}'))
    if (req.url?.includes('query=')) return void res.end(JSON.stringify({ recordings: [{ id: 'mbid-1', title: 'Wonderwall', 'artist-credit': [{ name: 'Oasis' }], 'first-release-date': '1995-10-02' }, { id: 'mbid-2', title: 'Unknown' }] }))
    res.end(JSON.stringify({ title: 'Wonderwall', 'artist-credit': [{ name: 'Oasis' }], 'first-release-date': '1995-10-02' }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ws/2/`
  // A local server stands in for MusicBrainz: its origin is declared like any other, and the add-on is told where to look.
  methods = createAddonMethods({ extraPermissions: { 'metadata-lookup': [`http:${new URL(baseUrl).origin}`] }, settings: { 'metadata-lookup': { baseUrl } } })
})
afterAll(() => void server.close())

describe('the metadata look-up add-on in the sandbox (#964)', () => {
  it('searches over the network from inside the sandbox, with a User-Agent, and maps the results', async () => {
    const plugin = createLookupAddonPlugin('metadata-lookup', { methods })
    const results = await plugin.search('Wonder wall')
    expect(results).toEqual([
      { id: 'mbid-1', title: 'Wonderwall', subtitle: 'Oasis · 1995-10-02', sourceUrl: 'https://musicbrainz.org/recording/mbid-1' },
      { id: 'mbid-2', title: 'Unknown', sourceUrl: 'https://musicbrainz.org/recording/mbid-2' },
    ])
    expect(seen.at(-1)?.url).toContain('query=Wonder%20wall')
    expect(seen.at(-1)?.ua).toMatch(/^StageBoard/)
  })

  it('fetches the detail of one recording', async () => {
    expect(await createLookupAddonPlugin('metadata-lookup', { methods }).fetchDetail('mbid-1')).toEqual({ title: 'Wonderwall', artist: 'Oasis', firstReleaseDate: '1995-10-02', sourceUrl: 'https://musicbrainz.org/recording/mbid-1' })
  })

  it('an HTTP error is an error ', async () => {
    await expect(createLookupAddonPlugin('metadata-lookup', { methods }).fetchDetail('bad')).rejects.toThrow('MusicBrainz request failed: HTTP 503')
  })
})
