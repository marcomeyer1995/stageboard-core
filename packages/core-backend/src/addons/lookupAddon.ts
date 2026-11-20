import type { ILookupPlugin, LookupResult } from 'shared-types'
import { LookupError } from '../plugins/lookupError.js'
import { ugDetailResult, missingDataError, type UgPage } from '../plugins/ultimateGuitarPlugin.js'
import type { NodeSandboxOptions } from './nodeSandbox.js'
import { BUILTIN_ADDONS, createAddonHost, type Log } from './addonHost.js'

/** The metadata look-up (MusicBrainz) as a sandboxed add-on (#964): an `ILookupPlugin` whose search and detail are calls to the add-on. */
export function createMusicBrainzAddonPlugin(options: { baseUrl?: string; log?: Log } = {}): ILookupPlugin {
  const manifest = { ...BUILTIN_ADDONS.metadataLookup, ...(options.baseUrl ? { settings: { baseUrl: options.baseUrl } } : {}) }
  const sandbox = createAddonHost(manifest, options.log)
  const ask = async (method: string, args: Record<string, unknown>): Promise<unknown> => {
    const outcome = await (await sandbox()).call(method, args, { timeoutMs: 20_000 })
    if (!outcome.ok) throw new Error(outcome.message)
    return outcome.data
  }
  return {
    name: 'metadata-lookup',
    version: '0.0.1',
    capabilities: [],
    init: (ctx) => ctx.log.info('metadata-lookup add-on initialized'),
    search: async (query) => (await ask('search', { query })) as LookupResult[],
    fetchDetail: async (id) => (await ask('fetchDetail', { id })) as Record<string, unknown>,
  }
}

type UgError = { code: string; message: string; messageCode?: string; messageParams?: Record<string, string | number> }

/** Ultimate Guitar as a sandboxed add-on (#964): the add-on reads the page through the `ug-page` helper and decides what its data means; the musician's
 * words for a failure and the conversion of the tab to ChordPro stay StageBoard's (the same functions as the built-in plugin). */
export function createUltimateGuitarAddonPlugin(options: { log?: Log; runHelper?: NodeSandboxOptions['runHelper'] } = {}): ILookupPlugin {
  const sandbox = createAddonHost(BUILTIN_ADDONS.ultimateGuitarLookup, options.log, options.runHelper)
  const ask = async (method: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const outcome = await (await sandbox()).call(method, args, { timeoutMs: 60_000 })
    if (!outcome.ok) throw new Error(outcome.message)
    const data = outcome.data as Record<string, unknown>
    const error = data.error as UgError | undefined
    if (error) {
      const message = error.messageCode ? ({ message: error.message, messageCode: error.messageCode, ...(error.messageParams ? { messageParams: error.messageParams } : {}) } as never) : error.message
      throw new LookupError(error.code as never, message)
    }
    return data
  }
  return {
    name: 'ultimate-guitar-scraper',
    version: '0.0.1',
    capabilities: [],
    init: (ctx) => ctx.log.info('ultimate-guitar-scraper add-on initialized'),
    async search(query) {
      const data = await ask('search', { query })
      const page = data.page as { hasData: boolean; title: string }
      if (!page.hasData) throw missingDataError(page.title)
      return data.results as LookupResult[]
    },
    async fetchDetail(resultId) {
      const separator = resultId.indexOf('::')
      if (separator === -1) throw new Error(`Malformed ultimate-guitar-scraper result id: ${resultId}`)
      const url = resultId.slice(separator + 2)
      const data = await ask('fetchDetail', { url })
      return ugDetailResult(url, data.page as UgPage, data.detail as Parameters<typeof ugDetailResult>[2])
    },
  }
}
