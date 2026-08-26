import { existsSync } from 'node:fs'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import type { ILookupPlugin, LookupResult, PluginContext } from 'shared-types'
import { convertUltimateGuitarContent } from './ultimateGuitarFormat.js'

const SEARCH_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
]

/** puppeteer-core brings no browser of its own on purpose (see the plugin doc comment) - this
 * just needs to find whichever real Chrome/Chromium is already on the host. */
function resolveChromeExecutable(): string {
  const configured = process.env.CHROME_EXECUTABLE_PATH
  if (configured) return configured
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new Error(
      `No Chrome/Chromium executable found. Set CHROME_EXECUTABLE_PATH, or install Chrome at one of: ${CHROME_CANDIDATES.join(', ')}`,
    )
  }
  return found
}

interface UgSearchResult {
  id: number
  song_name: string
  artist_name: string
  /** Present on the free chord/tab entries; absent on the paid "official"/"TabPro" ones,
   * which is exactly how those get filtered out below. */
  type?: string
  tonality_name?: string
  tab_url: string
}

interface UgTabPageData {
  content: string | null
  title: string | null
  artist: string | null
  key: string | null
  tuning: string | null
  /** Absent (not 0) means no capo - matches how UG's own meta.capo is only present at all
   * when a capo is actually used (verified live: absent on Wonderwall, `2` on "I'm Yours"). */
  capo: number | null
  bpm: number | null
}

/**
 * Real scraper, not a mock: Ultimate Guitar's search page sits behind Cloudflare's bot
 * challenge, which only a real browser executing JS gets past - a plain HTTP request (the
 * originally-planned cheerio approach) is served the challenge page, never real content.
 * Verified live against the real site while building this. Requires a Chrome/Chromium binary
 * on the Stage-Server host (see resolveChromeExecutable) - an external dependency, not an npm
 * one, the same shape as yt-dlp elsewhere in this roadmap; puppeteer-core deliberately ships
 * no bundled browser of its own.
 *
 * A private practice tool for personal, non-redistributed use - the same mitigation already
 * accepted for YouTube extraction elsewhere in this roadmap.
 */
export function createUltimateGuitarPlugin(): ILookupPlugin {
  let context: PluginContext | undefined
  let browserPromise: Promise<Browser> | null = null

  async function getBrowser(): Promise<Browser> {
    if (!browserPromise) {
      browserPromise = puppeteer.launch({
        executablePath: resolveChromeExecutable(),
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
    }
    return browserPromise
  }

  async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await getBrowser()
    const page = await browser.newPage()
    await page.setUserAgent(SEARCH_USER_AGENT)
    try {
      return await fn(page)
    } finally {
      await page.close()
    }
  }

  return {
    name: 'ultimate-guitar-scraper',
    version: '0.0.1',
    capabilities: [],
    init(ctx) {
      context = ctx
      context.log.info('ultimate-guitar-scraper plugin initialized')
    },
    async shutdown() {
      if (!browserPromise) return
      const browser = await browserPromise
      await browser.close()
      browserPromise = null
    },
    async search(query: string): Promise<LookupResult[]> {
      context?.log.info('ultimate-guitar-scraper search', { query })
      return withPage(async (page) => {
        await page.goto(
          `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}`,
          { waitUntil: 'networkidle2', timeout: 20_000 },
        )
        const results = await page.evaluate(
          () =>
            (globalThis as { UGAPP?: { store?: { page?: { data?: { results?: UgSearchResult[] } } } } }).UGAPP
              ?.store?.page?.data?.results ?? [],
        )

        // Entries with no `type` are the paid "official"/"TabPro" listings (they carry
        // `marketing_type` instead). Among the rest, "Pro"/"Official"/"Video" have no plain
        // wiki_tab.content at all (Pro/Official use UG's paid interactive player; Video just
        // links offsite) - fetchDetail would only fail on them, so they're excluded upfront
        // rather than left to surface as an error after the user picks one.
        const NOT_IMPORTABLE_TYPES = new Set(['Pro', 'Official', 'Video'])
        return results
          .filter((r) => typeof r.type === 'string' && r.type.length > 0 && !NOT_IMPORTABLE_TYPES.has(r.type))
          .map(
            (r): LookupResult => ({
              // The plugin is stateless between calls, so fetchDetail needs the full URL
              // encoded into the id itself rather than a server-side cache of the last search.
              // The id travels to the client and back as a single query-param value (see
              // lookupClient.ts), which already applies its own encodeURIComponent - encoding
              // the URL a second time here just makes the transported string longer for no
              // benefit, and previously tripped Fastify's path-param length limit.
              id: `${r.id}::${r.tab_url}`,
              title: r.song_name,
              subtitle: [r.artist_name, r.type, r.tonality_name].filter(Boolean).join(' · '),
              sourceUrl: r.tab_url,
            }),
          )
      })
    },
    async fetchDetail(resultId: string): Promise<Record<string, unknown>> {
      const separatorIndex = resultId.indexOf('::')
      if (separatorIndex === -1) {
        throw new Error(`Malformed ultimate-guitar-scraper result id: ${resultId}`)
      }
      const tabUrl = resultId.slice(separatorIndex + 2)

      return withPage(async (page) => {
        await page.goto(tabUrl, { waitUntil: 'networkidle2', timeout: 20_000 })
        const raw = await page.evaluate((): UgTabPageData => {
          const data = (
            globalThis as {
              UGAPP?: {
                store?: {
                  page?: {
                    data?: {
                      tab_view?: {
                        wiki_tab?: { content?: string }
                        meta?: { tonality?: string; tuning?: { name?: string; value?: string }; capo?: number }
                        strummings?: Array<{ bpm?: number }>
                      }
                      tab?: { song_name?: string; artist_name?: string; tonality_name?: string }
                    }
                  }
                }
              }
            }
          ).UGAPP?.store?.page?.data
          return {
            content: data?.tab_view?.wiki_tab?.content ?? null,
            title: data?.tab?.song_name ?? null,
            artist: data?.tab?.artist_name ?? null,
            key: data?.tab_view?.meta?.tonality ?? data?.tab?.tonality_name ?? null,
            tuning: data?.tab_view?.meta?.tuning?.value ?? data?.tab_view?.meta?.tuning?.name ?? null,
            capo: data?.tab_view?.meta?.capo ?? null,
            bpm: data?.tab_view?.strummings?.[0]?.bpm ?? null,
          }
        })
        if (!raw.content) throw new Error(`Could not extract tab content from ${tabUrl}`)
        return {
          title: raw.title,
          artist: raw.artist,
          key: raw.key,
          tuning: raw.tuning,
          capo: raw.capo,
          bpm: raw.bpm,
          sourceUrl: tabUrl,
          chordProContent: convertUltimateGuitarContent(raw.content),
        }
      })
    },
  }
}
