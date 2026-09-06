import type { PluginInstallation } from 'shared-types'
import type { ClientPluginModule } from './clientPluginModule'

const CACHE_NAME = 'stageboard-plugins'

/** The Cache API requires a real URL as its key, not an arbitrary string (`cache.put` throws
 * "Request scheme '...' is unsupported" otherwise, confirmed live) - a synthetic, never-fetched
 * `https://` URL under this app's own control satisfies that without meaning anything beyond
 * "this cache entry's identity". Still keyed by `id@version`, so a version bump is still
 * automatically a cache miss - no manual invalidation. */
function cacheKeyFor(plugin: Pick<PluginInstallation, 'id' | 'version'>): string {
  return `https://stageboard-plugin-cache.internal/${plugin.id}@${encodeURIComponent(plugin.version)}`
}

/** The Stage-Server's local mirror when one is configured (never needs this tablet's own
 * internet access), `clientSource` directly otherwise - the solo/home case (docs/00 §1's
 * Dry-Run Listener), fetched once over whatever internet this one device has, then cached. */
export function resolveClientBundleUrl(
  plugin: Pick<PluginInstallation, 'id' | 'clientSource'>,
  stageServerUrl: string | null,
): string | null {
  if (!plugin.clientSource) return null
  return stageServerUrl ? `${stageServerUrl}/plugins/${plugin.id}/client.js` : plugin.clientSource
}

/**
 * Fetches a plugin's client bundle once and caches it (Cache API, not a Service Worker - a
 * plain `caches.open`/`match`/`put` from page code is enough for a single on-demand resource,
 * no install/activate lifecycle needed). Keyed by `id@version`, so a version bump is
 * automatically a cache miss - no manual invalidation. Exported separately from
 * `loadClientPlugin` below so the fetch-vs-cache *decision* stays unit-testable
 * (loadClientPlugin.test.ts) without needing a real dynamic `import()`, which no test
 * environment here can exercise realistically.
 */
export async function fetchClientBundle(
  plugin: Pick<PluginInstallation, 'id' | 'version' | 'clientSource'>,
  stageServerUrl: string | null,
): Promise<Blob | null> {
  const url = resolveClientBundleUrl(plugin, stageServerUrl)
  if (!url) return null

  const cache = await caches.open(CACHE_NAME)
  const cacheKey = cacheKeyFor(plugin)
  const cached = await cache.match(cacheKey)
  if (cached) return cached.blob()

  const response = await fetch(url)
  if (!response.ok) return null
  await cache.put(cacheKey, response.clone())
  return response.blob()
}

/**
 * Loads (fetching+caching on first use, per `fetchClientBundle` above) and imports a plugin's
 * client bundle, returning its default export. Null whenever the plugin has no `clientSource`,
 * the fetch fails, or the module doesn't actually export a `ClientPluginModule` default -
 * callers treat all three identically ("nothing to use here"), same as `getTranslator`'s own
 * null-means-unavailable convention.
 */
export async function loadClientPlugin(
  plugin: Pick<PluginInstallation, 'id' | 'version' | 'clientSource'>,
  stageServerUrl: string | null,
): Promise<ClientPluginModule | null> {
  const blob = await fetchClientBundle(plugin, stageServerUrl)
  if (!blob) return null

  const blobUrl = URL.createObjectURL(blob)
  try {
    const imported = (await import(/* @vite-ignore */ blobUrl)) as { default?: ClientPluginModule }
    return imported.default ?? null
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}
