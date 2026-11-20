import { describe, expect, it } from 'vitest'
import { createUltimateGuitarAddonPlugin } from './lookupAddon.js'
import { createUltimateGuitarPlugin, ugSearchResults, ugTabDetail, ugDetailResult } from '../plugins/ultimateGuitarPlugin.js'

type Helper = NonNullable<Parameters<typeof createUltimateGuitarAddonPlugin>[0]>['runHelper']
const pages: Record<string, unknown> = {}
const asked: string[] = []
/** The `ug-page` helper stands in for Chrome: it hands back the page data of the URL it is asked for. */
const fakeChrome: Helper = async (helper, args) => {
  if (helper !== 'ug-page') throw new Error('no helper')
  asked.push(args[0]!)
  return { result: pages[args[0]!] ?? { error: { code: 'unavailable', message: 'UG ist nicht erreichbar', messageCode: 'ug.unavailable' } }, files: [] }
}

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
  it('searches: the add-on chooses and orders the importable versions exactly as the built-in plugin does', async () => {
    pages['https://www.ultimate-guitar.com/search.php?search_type=title&value=Wonderwall'] = SEARCH
    const results = await createUltimateGuitarAddonPlugin({ runHelper: fakeChrome }).search('Wonderwall')
    expect(results).toEqual(ugSearchResults(SEARCH.data))
    expect(results.map((r) => r.id.split('::')[0])).toEqual(['2', '1', '5'])
    expect(results[0]).toMatchObject({ rating: 4.81, votes: 11313 })
  })

  it('fetches a tab: the same detail, with ChordPro, as the built-in conversion', async () => {
    const url = 'https://tabs.ultimate-guitar.com/tab/oasis/wonderwall-chords-2'
    pages[url] = TAB
    const detail = await createUltimateGuitarAddonPlugin({ runHelper: fakeChrome }).fetchDetail(`2::${url}`)
    expect(detail).toEqual(ugDetailResult(url, TAB, ugTabDetail(TAB.data)))
    expect(detail).toMatchObject({ title: 'Wonderwall', artist: 'Oasis', key: 'F#m', tuning: 'E A D G B E', capo: 2, bpm: 87 })
    expect(String(detail.chordProContent)).toContain('Em7')
  })

  it('a failure with the musician\'s words (no Chrome, timeout...) arrives as a LookupError with its code and message code', async () => {
    const err = await createUltimateGuitarAddonPlugin({ runHelper: fakeChrome }).search('no-such-page').catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'LookupError', code: 'unavailable', messageCode: 'ug.unavailable' })
  })

  it('a page without data is "blocked" for a Cloudflare challenge and "source changed" for anything else', async () => {
    pages['https://www.ultimate-guitar.com/search.php?search_type=title&value=cf'] = { hasData: false, title: 'Just a moment...', data: null }
    pages['https://www.ultimate-guitar.com/search.php?search_type=title&value=new'] = { hasData: false, title: 'Brand new UG', data: null }
    const plugin = createUltimateGuitarAddonPlugin({ runHelper: fakeChrome })
    await expect(plugin.search('cf')).rejects.toMatchObject({ code: 'blocked' })
    await expect(plugin.search('new')).rejects.toMatchObject({ code: 'source-changed' })
  })

  it('a tab with no plain text (a paid player) is "not importable"; a malformed id is refused before any page is read', async () => {
    const url = 'https://tabs.ultimate-guitar.com/tab/pro'
    pages[url] = { hasData: true, title: 'Pro', data: { tab: { song_name: 'X' }, tab_view: {} } }
    const plugin = createUltimateGuitarAddonPlugin({ runHelper: fakeChrome })
    await expect(plugin.fetchDetail(`9::${url}`)).rejects.toMatchObject({ code: 'not-importable' })
    const before = asked.length
    await expect(plugin.fetchDetail('no-separator')).rejects.toThrow(/Malformed/)
    expect(asked.length).toBe(before)
  })

  it('has the same name, version and capabilities as the built-in plugin', () => {
    const a = createUltimateGuitarAddonPlugin({ runHelper: fakeChrome })
    const b = createUltimateGuitarPlugin()
    expect([a.name, a.version, a.capabilities]).toEqual([b.name, b.version, b.capabilities])
  })
})

describe('the ug-page helper (#964)', () => {
  it('opens only ultimate-guitar.com - the add-on cannot make the device\'s Chrome visit anything else', async () => {
    const { helperRunnerFor } = await import('./helpers.js')
    const run = helperRunnerFor(['ug-page'])
    for (const url of ['https://evil.example/', 'file:///etc/passwd', 'https://ultimate-guitar.com.evil.example/', 'http://www.ultimate-guitar.com/x'])
      await expect(run('ug-page', [url], () => {}, [])).rejects.toThrow('opens only ultimate-guitar.com')
  })
})
