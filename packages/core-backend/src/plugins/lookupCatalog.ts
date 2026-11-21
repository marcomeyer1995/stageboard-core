import type { ILookupPlugin } from 'shared-types'
import { loadAddonInfos } from '../addons/addonMethods.js'
import { createLookupAddonPlugin } from '../addons/lookupAddon.js'
import { SALE_BUILD } from './catalog.js'

/**
 * The lookup (query/response) plugins this build knows how to construct, keyed by the `:provider` path segment in `/lookup/:provider/...` - every add-on whose
 * manifest says it answers look-ups (`lookup`), so the core names none. Unlike PLUGIN_CATALOG these aren't reconciled against replicated PluginInstallation
 * docs: they are read-only data sources. A provider whose manifest says `requiresInstall` answers only bands that installed the add-on (checked in the
 * /lookup routes); one marked legally risky is missing from a sale build.
 */
export const LOOKUP_ADDONS = loadAddonInfos().filter((info) => info.lookup !== null && !(SALE_BUILD && info.legalRisk))
export const LOOKUP_CATALOG: Record<string, () => ILookupPlugin> = Object.fromEntries(LOOKUP_ADDONS.map((info) => [info.id, () => createLookupAddonPlugin(info.id)] as const))
