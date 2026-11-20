import { existsSync } from 'node:fs'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { convertUltimateGuitarContent, serverMessage, type ILookupPlugin, type LookupResult, type PluginContext } from 'shared-types'
import { LookupError } from './lookupError.js'

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
    throw new LookupError('no-browser', serverMessage('ug.chromePathWrong', { path: configured }))
  }
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new LookupError('no-browser', serverMessage('ug.chromeMissing', { paths: CHROME_CANDIDATES.join(', ') }))
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
      throw new LookupError('timeout', serverMessage('ug.timeout', { seconds: PAGE_TIMEOUT_MS / 1000 }), err)
    }
    if (err instanceof Error && /net::ERR_/.test(err.message)) {
      throw new LookupError('unavailable', serverMessage('ug.unavailable'), err)
    }
    throw err
  }
}

/** What a UG page offered when the expected data (`window.UGAPP.store.page.data`) was missing:
 * a Cloudflare challenge page means blocked (try later), anything else means UG rebuilt its
 * site and the plugin needs an update - previously both just looked like "no results". */
export function missingDataError(pageTitle: string): LookupError {
  if (/just a moment|attention required|cloudflare|access denied/i.test(pageTitle)) {
    return new LookupError('blocked', serverMessage('ug.blocked'))
  }
  return new LookupError('source-changed', serverMessage('ug.sourceChanged', { title: pageTitle || '-' }))
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
  /** 0-5 stars and the number of votes behind them (verified live: present on every free version). */
  rating?: number
  votes?: number
}

/** How sure the community is about a version: its stars, pulled towards an average 4.0 while it
 * has few votes (Bayesian average, weight 50 votes) - 4.86 stars from 406 votes should not beat
 * 4.81 from 11 313 just by the second decimal. Unrated versions come last. */
export function ratingScore(rating: number | undefined, votes: number | undefined): number {
  if (rating === undefined) return -1
  const v = Math.max(0, votes ?? 0)
  const PRIOR_VOTES = 50
  const PRIOR_RATING = 4
  return (v * rating + PRIOR_VOTES * PRIOR_RATING) / (v + PRIOR_VOTES)
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

/** What a UG page offered: whether the expected data was there, the page title, and `UGAPP.store.page.data` as plain JSON. */
export interface UgPage {
  hasData: boolean
  title: string
  data: unknown
}

/**
 * The browser side of Ultimate Guitar (#964): one Chrome kept for the reader's lifetime, a page opened per read. It is the device's *helper*
 * (`ug-page`, addons/helpers.ts) when the look-up runs as a sandboxed add-on, and the built-in plugin's own browser otherwise - one copy of the
 * Chrome handling either way. It knows nothing about what UG's data means; that is the plugin's / the add-on's job.
 */
export function createUgPageReader(): { read(url: string): Promise<UgPage>; close(): Promise<void> } {
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
    read: (url) =>
      withPage(async (page) => {
        await openUgPage(page, url)
        return page.evaluate((): UgPage => {
          const data = (globalThis as { UGAPP?: { store?: { page?: { data?: unknown } } } }).UGAPP?.store?.page?.data
          return { hasData: data !== undefined, title: document.title, data: data === undefined ? null : JSON.parse(JSON.stringify(data)) }
        })
      }),
    async close() {
      if (!browserPromise) return
      const browser = await browserPromise
      await browser.close()
      browserPromise = null
    },
  }
}

/** The search page's data as the list the musician picks from: importable versions only, best-rated first. */
export function ugSearchResults(data: unknown): LookupResult[] {
  const results = (data as { results?: UgSearchResult[] } | null)?.results ?? []
  // Entries with no `type` are the paid "official"/"TabPro" listings (they carry `marketing_type` instead). Among the rest, "Pro"/"Official"/"Video"
  // have no plain wiki_tab.content at all (Pro/Official use UG's paid interactive player; Video just links offsite) - fetchDetail would only fail on
  // them, so they're excluded upfront rather than left to surface as an error after the user picks one.
  const NOT_IMPORTABLE_TYPES = new Set(['Pro', 'Official', 'Video'])
  // Best-rated first (Marco): the version the community trusts most is usually the one to take.
  return results
    .filter((r) => typeof r.type === 'string' && r.type.length > 0 && !NOT_IMPORTABLE_TYPES.has(r.type))
    .sort((a, b) => ratingScore(b.rating, b.votes) - ratingScore(a.rating, a.votes))
    .map(
      (r): LookupResult => ({
        // The id carries the full URL (stateless between calls); it travels as one query-param value that the client already encodes once.
        id: `${r.id}::${r.tab_url}`,
        title: r.song_name,
        subtitle: [r.artist_name, r.type, r.tonality_name].filter(Boolean).join(' · '),
        sourceUrl: r.tab_url,
        ...(typeof r.rating === 'number' ? { rating: Math.round(r.rating * 100) / 100 } : {}),
        ...(typeof r.votes === 'number' ? { votes: r.votes } : {}),
      }),
    )
}

interface UgTabData {
  tab_view?: { wiki_tab?: { content?: string }; meta?: { tonality?: string; tuning?: { name?: string; value?: string }; capo?: number }; strummings?: Array<{ bpm?: number }> }
  tab?: { song_name?: string; artist_name?: string; tonality_name?: string }
}

/** One tab page's data as the detail the editor imports; `null` content means it has no plain tab (a paid player). */
export function ugTabDetail(data: unknown): UgTabPageData {
  const d = data as UgTabData | null
  return {
    content: d?.tab_view?.wiki_tab?.content ?? null,
    title: d?.tab?.song_name ?? null,
    artist: d?.tab?.artist_name ?? null,
    key: d?.tab_view?.meta?.tonality ?? d?.tab?.tonality_name ?? null,
    tuning: d?.tab_view?.meta?.tuning?.value ?? d?.tab_view?.meta?.tuning?.name ?? null,
    capo: d?.tab_view?.meta?.capo ?? null,
    bpm: d?.tab_view?.strummings?.[0]?.bpm ?? null,
  }
}

/** The detail the routes return, from the page data (shared by the built-in plugin and the add-on's adapter). */
export function ugDetailResult(tabUrl: string, page: UgPage, detail: UgTabPageData): Record<string, unknown> {
  if (!page.hasData) throw missingDataError(page.title)
  if (!detail.content) throw new LookupError('not-importable', serverMessage('ug.notImportable'))
  return {
    title: detail.title,
    artist: detail.artist,
    key: detail.key,
    tuning: detail.tuning,
    capo: detail.capo,
    bpm: detail.bpm,
    sourceUrl: tabUrl,
    chordProContent: convertUltimateGuitarContent(detail.content),
  }
}

export const ugSearchUrl = (query: string): string => `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}`

/**
 * Real scraper, not a mock: Ultimate Guitar's search page sits behind Cloudflare's bot
 * challenge, which only a real browser executing JS gets past - a plain HTTP request (the
 * originally-planned cheerio approach) is served the challenge page, never real content.
 * Verified live against the real site while building this. Requires a Chrome/Chromium binary
 * on the Host host (see resolveChromeExecutable) - an external dependency, not an npm
 * one, the same shape as yt-dlp elsewhere in this roadmap; puppeteer-core deliberately ships
 * no bundled browser of its own.
 *
 * A private practice tool for personal, non-redistributed use - the same mitigation already
 * accepted for YouTube extraction elsewhere in this roadmap.
 */
export function createUltimateGuitarPlugin(): ILookupPlugin {
  let context: PluginContext | undefined
  const reader = createUgPageReader()

  return {
    name: 'ultimate-guitar-scraper',
    version: '0.0.1',
    capabilities: [],
    init(ctx) {
      context = ctx
      context.log.info('ultimate-guitar-scraper plugin initialized')
    },
    shutdown: () => reader.close(),
    async search(query: string): Promise<LookupResult[]> {
      context?.log.info('ultimate-guitar-scraper search', { query })
      const page = await reader.read(ugSearchUrl(query))
      // No data at all is not "no results" (UG then still sends an empty list) - it's a challenge page or a rebuilt site, and the musician should be told which.
      if (!page.hasData) throw missingDataError(page.title)
      return ugSearchResults(page.data)
    },
    async fetchDetail(resultId: string): Promise<Record<string, unknown>> {
      const separatorIndex = resultId.indexOf('::')
      if (separatorIndex === -1) throw new Error(`Malformed ultimate-guitar-scraper result id: ${resultId}`)
      const tabUrl = resultId.slice(separatorIndex + 2)
      const page = await reader.read(tabUrl)
      return ugDetailResult(tabUrl, page, ugTabDetail(page.data))
    },
  }
}
