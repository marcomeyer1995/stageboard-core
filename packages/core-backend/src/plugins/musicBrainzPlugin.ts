import type { ILookupPlugin, LookupResult, PluginContext } from 'shared-types'

/** MusicBrainz's API guidelines require a descriptive User-Agent identifying the app - an
 * anonymous/generic one gets rate-limited harder or blocked outright. */
const USER_AGENT = 'StageBoard/0.1 (local band-management tool, no public deployment)'

interface MusicBrainzRecording {
  id: string
  title: string
  'artist-credit'?: Array<{ name: string }>
  'first-release-date'?: string
}

/**
 * Metadata-assist via MusicBrainz's official free REST API - lower legal risk than scraping,
 * per this roadmap's own preference (docs/01 "Key Finder" mentions BPM/key, but MusicBrainz
 * itself only has title/artist/first-release-date; the BPM/key analysis service that used to
 * complement it, AcousticBrainz, was discontinued, so this plugin confirms song identity, not
 * tempo or key).
 */
export function createMusicBrainzPlugin(): ILookupPlugin {
  let context: PluginContext | undefined

  async function request(path: string): Promise<unknown> {
    const response = await fetch(`https://musicbrainz.org/ws/2/${path}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`MusicBrainz request failed: HTTP ${response.status}`)
    return response.json()
  }

  return {
    name: 'metadata-lookup',
    version: '0.0.1',
    capabilities: [],
    init(ctx) {
      context = ctx
      context.log.info('metadata-lookup plugin initialized')
    },
    async search(query: string): Promise<LookupResult[]> {
      context?.log.info('metadata-lookup search', { query })
      const body = (await request(`recording/?query=${encodeURIComponent(query)}&fmt=json&limit=10`)) as {
        recordings?: MusicBrainzRecording[]
      }
      return (body.recordings ?? []).map(
        (recording): LookupResult => ({
          id: recording.id,
          title: recording.title,
          subtitle:
            [recording['artist-credit']?.[0]?.name, recording['first-release-date']]
              .filter(Boolean)
              .join(' · ') || undefined,
          sourceUrl: `https://musicbrainz.org/recording/${recording.id}`,
        }),
      )
    },
    async fetchDetail(resultId: string): Promise<Record<string, unknown>> {
      const recording = (await request(
        `recording/${encodeURIComponent(resultId)}?fmt=json&inc=artist-credits`,
      )) as MusicBrainzRecording
      return {
        title: recording.title ?? null,
        artist: recording['artist-credit']?.[0]?.name ?? null,
        firstReleaseDate: recording['first-release-date'] ?? null,
        sourceUrl: `https://musicbrainz.org/recording/${resultId}`,
      }
    },
  }
}
