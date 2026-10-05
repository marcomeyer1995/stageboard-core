import { existsSync } from 'node:fs'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import type { ILookupPlugin, LookupResult, PluginContext } from 'shared-types'
import { LookupError } from './lookupError.js'
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
export function resolveChromeExecutable(): string {
  const configured = process.env.CHROME_EXECUTABLE_PATH
  if (configured) {
    if (existsSync(configured)) return configured
    throw new LookupError('no-browser', `CHROME_EXECUTABLE_PATH zeigt auf „${configured}“ - dort ist kein Chrome/Chromium. Pfad korrigieren oder die Variable entfernen.`)
  }
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new LookupError(
      'no-browser',
      `Für Ultimate Guitar braucht der Stage-Server Chrome oder Chromium - keins gefunden. Installieren (z. B. „sudo apt install chromium“) oder CHROME_EXECUTABLE_PATH setzen. Gesucht in: ${CHROME_CANDIDATES.join(', ')}`,
    )
  }
  return found
}

const PAGE_TIMEOUT_MS = 20_000

/** Opens a UG page; a timeout or a network failure becomes an error that says what to check. */
export async function openUgPage(page: Pick<Page, 'goto'>, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new LookupError('timeout', `Ultimate Guitar antwortet nicht (${PAGE_TIMEOUT_MS / 1000} s). Internetverbindung des Stage-Servers prüfen und noch einmal versuchen.`, err)
    }
    if (err instanceof Error && /net::ERR_/.test(err.message)) {
      throw new LookupError('unavailable', 'Ultimate Guitar ist nicht erreichbar - hat der Stage-Server gerade Internet?', err)
    }
    throw err
  }
}

/** What a UG page offered when the expected data (`window.UGAPP.store.page.data`) was missing:
 * a Cloudflare challenge page means blocked (try later), anything else means UG rebuilt its
 * site and the plugin needs an update - previously both just looked like "no results". */
export function missingDataError(pageTitle: string): LookupError {
  if (/just a moment|attention required|cloudflare|access denied/i.test(pageTitle)) {
    return new LookupError('blocked', 'Ultimate Guitar hat die Anfrage als Bot blockiert. In ein paar Minuten noch einmal versuchen.')
  }
  return new LookupError(
    'source-changed',
    `Ultimate Guitar hat seine Seite umgebaut - der Import (Plugin „ultimate-guitar-scraper“) muss angepasst werden. Seitentitel: „${pageTitle || 'leer'}“`,
  )
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

  function launchBrowser(): Promise<Browser> {
    return puppeteer.launch({
      executablePath: resolveChromeExecutable(),
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      // The server owns process signals (gracefulShutdown.ts, #335) - Puppeteer's own SIGTERM
      // listener only closed Chrome and never exited, so every restart hung until SIGKILL.
      // Chrome is closed by this plugin's shutdown() during app.close() instead.
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    })
  }

  /** `browserPromise` is cached for the plugin's whole lifetime (launching Chrome per request
   * would be far too slow) - but that means a Chrome crash or a dropped CDP connection used to
   * wedge every future search/import behind the same dead instance forever (`Connection.send`
   * throws `ConnectionClosedError: Connection closed.` once the underlying websocket has
   * closed), recoverable only by restarting the whole core-backend process. Confirmed live,
   * 2026-09-11: every UG lookup failed identically until a manual restart. */
  async function getBrowser(): Promise<Browser> {
    if (browserPromise) {
      const existing = await browserPromise
      if (existing.connected) return existing
      browserPromise = null
    }
    browserPromise = launchBrowser()
    return browserPromise
  }

  function isConnectionError(err: unknown): boolean {
    return err instanceof Error && /connection closed|not connected|disconnected/i.test(err.message)
  }

  async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    const browser = await getBrowser()
    let page: Page
    try {
      page = await browser.newPage()
    } catch (err) {
      // `existing.connected` above can still race with the connection dying right after the
      // check - one transparent relaunch-and-retry covers that without surfacing a spurious
      // error to the user for what's really a one-off hiccup.
      if (!isConnectionError(err)) throw err
      browserPromise = null
      page = await (await getBrowser()).newPage()
    }
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
        await openUgPage(page, `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}`)
        const found = await page.evaluate(() => {
          const data = (globalThis as { UGAPP?: { store?: { page?: { data?: { results?: UgSearchResult[] } } } } }).UGAPP?.store?.page?.data
          return { hasData: data !== undefined, results: data?.results ?? [], title: document.title }
        })
        // No data at all is not "no results" (UG then still sends an empty list) - it's a
        // challenge page or a rebuilt site, and the musician should be told which.
        if (!found.hasData) throw missingDataError(found.title)
        const results = found.results

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
        await openUgPage(page, tabUrl)
        const raw = await page.evaluate((): UgTabPageData & { hasData: boolean; pageTitle: string } => {
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
            hasData: data !== undefined,
            pageTitle: document.title,
            content: data?.tab_view?.wiki_tab?.content ?? null,
            title: data?.tab?.song_name ?? null,
            artist: data?.tab?.artist_name ?? null,
            key: data?.tab_view?.meta?.tonality ?? data?.tab?.tonality_name ?? null,
            tuning: data?.tab_view?.meta?.tuning?.value ?? data?.tab_view?.meta?.tuning?.name ?? null,
            capo: data?.tab_view?.meta?.capo ?? null,
            bpm: data?.tab_view?.strummings?.[0]?.bpm ?? null,
          }
        })
        if (!raw.hasData) throw missingDataError(raw.pageTitle)
        if (!raw.content) {
          throw new LookupError('not-importable', 'Diese Version hat keinen Text zum Übernehmen (z. B. eine Pro- oder Video-Version). Bitte eine andere Version wählen.')
        }
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
