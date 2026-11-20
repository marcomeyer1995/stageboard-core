import type { ILookupPlugin, LookupResult } from 'shared-types'
import { LookupError } from '../plugins/lookupError.js'
import { sharedAddonMethods, type AddonMethods } from './addonMethods.js'

/**
 * A look-up add-on (search, fetchDetail) as an `ILookupPlugin` for the `/lookup` routes (#964). This is all StageBoard knows about a look-up: two
 * methods and their answers. What the service is, how its data is read and what to tell the musician when it fails is the add-on's - a failed call
 * comes back with the add-on's own words and a code (`blocked`, `timeout`, ...) that the route hands to the app unchanged.
 */
export function createLookupAddonPlugin(addonId: string, options: { methods?: AddonMethods } = {}): ILookupPlugin {
  const methods = options.methods ?? sharedAddonMethods()
  const ask = async (method: string, body: Record<string, unknown>): Promise<unknown> => {
    const answer = await methods.call(addonId, method, body)
    if (!answer.ok) throw new LookupError(answer.error.code, answer.error.message)
    return answer.body
  }
  return {
    name: addonId,
    version: '0.0.1',
    capabilities: [],
    init: (ctx) => ctx.log.info(`${addonId} add-on initialized`),
    search: async (query) => (await ask('search', { query })) as LookupResult[],
    fetchDetail: async (id) => (await ask('fetchDetail', { id })) as Record<string, unknown>,
  }
}

export const createMusicBrainzAddonPlugin = (options: { methods?: AddonMethods } = {}): ILookupPlugin => createLookupAddonPlugin('metadata-lookup', options)
export const createUltimateGuitarAddonPlugin = (options: { methods?: AddonMethods } = {}): ILookupPlugin => createLookupAddonPlugin('ultimate-guitar-scraper', options)
