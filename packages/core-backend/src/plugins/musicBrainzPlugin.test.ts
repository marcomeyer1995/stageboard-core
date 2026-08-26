import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginContext } from 'shared-types'
import { createMusicBrainzPlugin } from './musicBrainzPlugin.js'

function testContext(): PluginContext {
  return { log: { info: vi.fn(), error: vi.fn() } }
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('musicBrainzPlugin', () => {
  it('maps a search response into LookupResults', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        recordings: [
          {
            id: 'mbid-1',
            title: 'Wonderwall',
            'artist-credit': [{ name: 'Oasis' }],
            'first-release-date': '1995-10-02',
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const plugin = createMusicBrainzPlugin()
    plugin.init(testContext())
    const results = await plugin.search('Wonderwall')

    expect(results).toEqual([
      {
        id: 'mbid-1',
        title: 'Wonderwall',
        subtitle: 'Oasis · 1995-10-02',
        sourceUrl: 'https://musicbrainz.org/recording/mbid-1',
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('musicbrainz.org/ws/2/recording/?query=Wonderwall'),
      expect.objectContaining({ headers: expect.objectContaining({ 'User-Agent': expect.any(String) }) }),
    )
  })

  it('omits the subtitle when neither artist nor release date is known', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ recordings: [{ id: 'mbid-2', title: 'Unknown Song' }] })),
    )

    const plugin = createMusicBrainzPlugin()
    plugin.init(testContext())
    const [result] = await plugin.search('Unknown Song')

    expect(result.subtitle).toBeUndefined()
  })

  it('returns an empty array when the API returns no recordings', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    const plugin = createMusicBrainzPlugin()
    plugin.init(testContext())
    expect(await plugin.search('nothing')).toEqual([])
  })

  it('throws with the HTTP status when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 503)))

    const plugin = createMusicBrainzPlugin()
    plugin.init(testContext())
    await expect(plugin.search('anything')).rejects.toThrow('503')
  })

  it('fetchDetail maps a recording into a detail record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 'mbid-1',
          title: 'Wonderwall',
          'artist-credit': [{ name: 'Oasis' }],
          'first-release-date': '1995-10-02',
        }),
      ),
    )

    const plugin = createMusicBrainzPlugin()
    plugin.init(testContext())
    const detail = await plugin.fetchDetail('mbid-1')

    expect(detail).toEqual({
      title: 'Wonderwall',
      artist: 'Oasis',
      firstReleaseDate: '1995-10-02',
      sourceUrl: 'https://musicbrainz.org/recording/mbid-1',
    })
  })
})
