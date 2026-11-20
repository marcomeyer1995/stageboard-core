import type { ILookupPlugin, LookupResult } from 'shared-types'
import { LookupError } from '../plugins/lookupError.js'
import { BUILTIN_ADDONS, createAddonHost, type AddonManifest, type Log } from './addonHost.js'
import type { NodeSandboxOptions } from './nodeSandbox.js'

/**
 * A look-up add-on (search, fetchDetail) as an `ILookupPlugin` for the `/lookup` routes (#964). This is all StageBoard knows about a look-up: two calls
 * and their answers. What the service is, how its data is read and what to tell the musician when it fails is the add-on's - a failed call comes
 * back with the add-on's own words and a code (`blocked`, `timeout`, ...) that the route hands to the app unchanged.
 */
export function createLookupAddonPlugin(manifest: AddonManifest, options: { baseUrl?: string; log?: Log; runHelper?: NodeSandboxOptions['runHelper'] } = {}): ILookupPlugin {
  const sandbox = createAddonHost({ ...manifest, ...(options.baseUrl ? { settings: { baseUrl: options.baseUrl } } : {}) }, options.log, options.runHelper)
  const ask = async (method: string, args: Record<string, unknown>): Promise<unknown> => {
    const outcome = await (await sandbox()).call(method, args, { timeoutMs: 60_000 })
    if (!outcome.ok) throw outcome.messageCode ? new LookupError(outcome.messageCode, outcome.message) : new Error(outcome.message)
    return outcome.data
  }
  return {
    name: manifest.id,
    version: '0.0.1',
    capabilities: [],
    init: (ctx) => ctx.log.info(`${manifest.id} add-on initialized`),
    search: async (query) => (await ask('search', { query })) as LookupResult[],
    fetchDetail: async (id) => (await ask('fetchDetail', { id })) as Record<string, unknown>,
  }
}

export const createMusicBrainzAddonPlugin = (options: Parameters<typeof createLookupAddonPlugin>[1] = {}): ILookupPlugin => createLookupAddonPlugin(BUILTIN_ADDONS.metadataLookup, options)
export const createUltimateGuitarAddonPlugin = (options: Parameters<typeof createLookupAddonPlugin>[1] = {}): ILookupPlugin => createLookupAddonPlugin(BUILTIN_ADDONS.ultimateGuitarLookup, options)
