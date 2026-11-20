import { describe, expect, it } from 'vitest'
import { createUltimateGuitarAddonPlugin } from './lookupAddon.js'
import { createAddonMethods, type HelperRunFn } from './addonMethods.js'

type Helper = HelperRunFn
const pages: Record<string, unknown> = {}
const asked: string[] = []
/** The `ug-page` helper stands in for Chrome: it hands back the page data of the URL it is asked for. */
const fakeChrome: Helper = async (helper, args) => {
  if (helper !== 'ug-page') throw new Error('no helper')
  asked.push(args[0]!)
  return { result: pages[args[0]!] ?? { error: { code: 'unavailable', params: {} } }, files: [] }
}

/** The add-on's real work script, with the device's Chrome replaced by the stand-in: everything else is the real path. */
const withChrome = createAddonMethods({ runHelper: (addonId) => (addonId === 'ultimate-guitar-scraper' ? fakeChrome : undefined) })

const SEARCH = {
  hasData: true, title: 'Search',
  data: { results: [
    { id: 1, song_name: 'Wonderwall', artist_name: 'Oasis', type: 'Chords', tonality_name: 'F#m', tab_url: 'https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-1', rating: 4.86, votes: 406 },
    { id: 2, song_name: 'Wonderwall', artist_name: 'Oasis', type: 'Chords', tab_url: 'https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-2', rating: 4.81, votes: 11313 },
    { id: 3, song_name: 'Wonderwall', artist_name: 'Oasis', type: 'Pro', tab_url: 'https://x/3', rating: 5, votes: 99999 },
    { id: 4, song_name: 'Wonderwall', artist_name: 'Oasis', tab_url: 'https://x/4' },
    { id: 5, song_name: 'Wonderwall', artist_name: 'Oasis', type: 'Tabs', tab_url: 'https://x/5' },
  ] },
}
const TAB = {
  hasData: true, title: 'Tab',
  data: { tab: { song_name: 'Wonderwall', artist_name: 'Oasis', tonality_name: 'F#m' }, tab_view: { wiki_tab: { content: '[ch]Em7[/ch] Today is gonna be' }, meta: { capo: 2, tuning: { name: 'Standard', value: 'E A D G B E' } }, strummings: [{ bpm: 87 }] } },
}

describe('the Ultimate Guitar add-on in the sandbox (#964)', () => {
  it('searches: the add-on chooses and orders the importable versions - the community trust (4.81 stars from 11,313 votes beats 4.86 from 406), no Pro, no unrated paid listings', async () => {
    pages['https://www.ultimate-guitar.com/search.php?search_type=title&value=Wonderwall'] = SEARCH
    const results = await createUltimateGuitarAddonPlugin({ methods: withChrome }).search('Wonderwall')
    expect(results.map((r) => r.id.split('::')[0])).toEqual(['2', '1', '5'])
    expect(results[0]).toMatchObject({ rating: 4.81, votes: 11313 })
  })

  it('fetches a tab: its details and the tab text converted to ChordPro by the add-on', async () => {
    const url = 'https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-2'
    pages[url] = TAB
    const detail = await createUltimateGuitarAddonPlugin({ methods: withChrome }).fetchDetail(`2::${url}`)
    expect(detail).toMatchObject({ title: 'Wonderwall', artist: 'Oasis', key: 'F#m', tuning: 'E A D G B E', capo: 2, bpm: 87 })
    expect(detail.chordProContent).toBe('[Em7] Today is gonna be')
  })

  it('a failure the Chrome helper reports as a code arrives as a LookupError with the add-on\'s own words', async () => {
    const err = await createUltimateGuitarAddonPlugin({ methods: withChrome }).search('no-such-page').catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'LookupError', code: 'unavailable', message: 'Ultimate Guitar ist nicht erreichbar - hat das Gerät gerade Internet?' })
  })

  it('a page without data is "blocked" for a Cloudflare challenge and "source changed" for anything else', async () => {
    pages['https://www.ultimate-guitar.com/search.php?search_type=title&value=cf'] = { hasData: false, title: 'Just a moment...', data: null }
    pages['https://www.ultimate-guitar.com/search.php?search_type=title&value=new'] = { hasData: false, title: 'Brand new UG', data: null }
    const plugin = createUltimateGuitarAddonPlugin({ methods: withChrome })
    await expect(plugin.search('cf')).rejects.toMatchObject({ code: 'blocked' })
    await expect(plugin.search('new')).rejects.toMatchObject({ code: 'source-changed' })
  })

  it('a tab with no plain text (a paid player) is "not importable"; a malformed id is refused before any page is read', async () => {
    const url = 'https://tabs.ultimate-guitar.com/tab/pro'
    pages[url] = { hasData: true, title: 'Pro', data: { tab: { song_name: 'X' }, tab_view: {} } }
    const plugin = createUltimateGuitarAddonPlugin({ methods: withChrome })
    await expect(plugin.fetchDetail(`9::${url}`)).rejects.toMatchObject({ code: 'not-importable' })
    const before = asked.length
    await expect(plugin.fetchDetail('no-separator')).rejects.toThrow(/Malformed/)
    expect(asked.length).toBe(before)
  })

  it('says what to do when there is no Chrome, in words that carry the path or the search places', async () => {
    pages['https://www.ultimate-guitar.com/search.php?search_type=title&value=nochrome'] = { error: { code: 'chrome-path-wrong', params: { path: '/opt/nope' } } }
    pages['https://www.ultimate-guitar.com/search.php?search_type=title&value=timeout'] = { error: { code: 'timeout', params: { seconds: 20 } } }
    const plugin = createUltimateGuitarAddonPlugin({ methods: withChrome })
    await expect(plugin.search('nochrome')).rejects.toMatchObject({ code: 'no-browser', message: expect.stringContaining('„/opt/nope“') })
    await expect(plugin.search('timeout')).rejects.toMatchObject({ code: 'timeout', message: expect.stringContaining('(20 s)') })
  })

  it('names the page in "source changed" so the add-on can be fixed', async () => {
    pages['https://www.ultimate-guitar.com/search.php?search_type=title&value=rebuilt'] = { hasData: false, title: 'WONDERWALL CHORDS by Oasis', data: null }
    await expect(createUltimateGuitarAddonPlugin({ methods: withChrome }).search('rebuilt')).rejects.toMatchObject({ code: 'source-changed', message: expect.stringContaining('WONDERWALL CHORDS') })
  })
})

describe('the ug-page helper (#964)', () => {
  it('opens only ultimate-guitar.com - the add-on cannot make the device\'s Chrome visit anything else', async () => {
    const { helperRunnerFor } = await import('./helpers.js')
    const run = helperRunnerFor(['ug-page'])
    for (const url of ['https://evil.example/', 'file:///etc/passwd', 'https://ultimate-guitar.com.evil.example/', 'http://www.ultimate-guitar.com/x', 'https://tabs.ultimate-guitar.com.evil.example/x', 'https://evil.tabs.ultimate-guitar.com/x', 'https://www.ultimate-guitar.com@evil.example/'])
      await expect(run('ug-page', [url], () => {}, [])).rejects.toThrow('opens only ultimate-guitar.com')
  })
})

describe('the ug-page helper accepts the pages UG really serves (#964)', () => {
  it('the tab pages of the search results live on tabs.ultimate-guitar.com - the helper must open them (it refused them once; the stand-in Chrome of the other tests never asked)', async () => {
    const { helperRunnerFor } = await import('./helpers.js')
    // Not a real Chrome: whichever error comes, it must NOT be the helper's own refusal of the address.
    for (const url of ['https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-39080', 'https://www.ultimate-guitar.com/search.php?search_type=title&value=x', 'https://ultimate-guitar.com/x']) {
      const attempt = await Promise.race([helperRunnerFor(['ug-page'])('ug-page', [url], () => {}, []).then(() => 'opened', (err: Error) => err.message), new Promise((r) => setTimeout(() => r('opened'), 1_500))])
      expect(String(attempt), url).not.toContain('opens only')
    }
  })
})
