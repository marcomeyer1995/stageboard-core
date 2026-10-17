import type { ILookupPlugin } from 'shared-types'
import { createMusicBrainzPlugin } from './musicBrainzPlugin.js'
import { createUltimateGuitarPlugin } from './ultimateGuitarPlugin.js'
import { SALE_BUILD, ULTIMATE_GUITAR_PROVIDER } from './importAddons.js'

/**
 * The lookup (query/response) plugins this build knows how to construct, keyed by the
 * `:provider` path segment in `/lookup/:provider/...`. Unlike PLUGIN_CATALOG, these aren't
 * reconciled against replicated PluginInstallation docs - they're not band-installed hardware
 * adapters, just read-only data sources. Ultimate Guitar answers only bands that installed its
 * add-on (#546, checked in the /lookup routes) and is missing from a sale build; MusicBrainz is
 * metadata only and stays built in.
 */
export const LOOKUP_CATALOG: Record<string, () => ILookupPlugin> = {
  ...(SALE_BUILD ? {} : { [ULTIMATE_GUITAR_PROVIDER]: createUltimateGuitarPlugin }),
  'metadata-lookup': createMusicBrainzPlugin,
}
