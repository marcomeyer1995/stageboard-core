import { existsSync } from 'node:fs'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'

/**
 * The device's Chrome for pages that need a real browser (#964): the helper `ug-page` of the Ultimate Guitar add-on, nothing more. It knows nothing
 * about Ultimate Guitar's data, markup or the musician's words - a failure is a **code** with parameters (`BrowserError`), and the add-on that asked
 * says it in words. puppeteer-core brings no browser of its own on purpose: this finds whichever Chrome/Chromium the device already has.
 */
export class BrowserError extends Error {
  constructor(
    readonly code: 'chrome-path-wrong' | 'chrome-missing' | 'timeout' | 'unavailable',
    readonly params: Record<string, string | number> = {},
    message = code,
  ) {
    super(message)
    this.name = 'BrowserError'
  }
}

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
    throw new BrowserError('chrome-path-wrong', { path: configured })
  }
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) {
    throw new BrowserError('chrome-missing', { paths: CHROME_CANDIDATES.join(', ') })
  }
  return found
}

const PAGE_TIMEOUT_MS = 20_000

/** Opens a UG page; a timeout or a network failure becomes an error that says what to check. */
export async function openPage(page: Pick<Page, 'goto'>, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: PAGE_TIMEOUT_MS })
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new BrowserError('timeout', { seconds: PAGE_TIMEOUT_MS / 1000 })
    }
    if (err instanceof Error && /net::ERR_/.test(err.message)) {
      throw new BrowserError('unavailable')
    }
    throw err
  }
}

/** What a UG page offered: whether the expected data was there, the page title, and `UGAPP.store.page.data` as plain JSON. */
export interface BrowserPage {
  hasData: boolean
  title: string
  data: unknown
}

/**
 * The browser side of Ultimate Guitar (#964): one Chrome kept for the reader's lifetime, a page opened per read. It is the device's *helper*
 * (`ug-page`, addons/helpers.ts) when the look-up runs as a sandboxed add-on, and the built-in plugin's own browser otherwise - one copy of the
 * Chrome handling either way. It knows nothing about what UG's data means; that is the plugin's / the add-on's job.
 */
export function createBrowserReader(): { read(url: string): Promise<BrowserPage>; close(): Promise<void> } {
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
        await openPage(page, url)
        return page.evaluate((): BrowserPage => {
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

