import type { ILookupPlugin } from 'shared-types'
import { createMusicBrainzPlugin } from './musicBrainzPlugin.js'
import { createUltimateGuitarPlugin } from './ultimateGuitarPlugin.js'

/**
 * The lookup (query/response) plugins this build knows how to construct, keyed by the
 * `:provider` path segment in `/lookup/:provider/...`. Unlike PLUGIN_CATALOG, these aren't
 * reconciled against replicated PluginInstallation docs - they're not band-installed hardware
 * adapters, just read-only data sources the server always has available.
 */
export const LOOKUP_CATALOG: Record<string, () => ILookupPlugin> = {
  'ultimate-guitar-scraper': createUltimateGuitarPlugin,
  'metadata-lookup': createMusicBrainzPlugin,
}
