import { DEFAULT_PLUGIN_HEALTH, type PluginHealth } from 'shared-types'

/**
 * Server-Sent Events stream of plugin/hardware health for one workspace - replaces the old
 * PouchDB-synced 'plugin-health' doc (see #49 follow-up: a heartbeat has no offline/
 * multi-master value, so smuggling it through CouchDB sync was the wrong tool, and it broke
 * the sync-status indicator's noise filtering in the process). The Stage-Server pushes the
 * *full* snapshot on every change, so there is no merge logic here - just replace.
 *
 * `EventSource` retries dropped connections on its own (a browser built-in) - no explicit
 * reconnect/backoff logic needed. No `VITE_STAGE_SERVER_URL` (e.g. Tier 1 "Solo," no server
 * at all) means there is nothing to subscribe to - the caller just keeps the default health.
 */
export function subscribeToPluginHealth(
  workspaceId: string,
  onHealth: (health: PluginHealth) => void,
): () => void {
  const base = import.meta.env.VITE_STAGE_SERVER_URL as string | undefined
  if (!base) {
    onHealth(DEFAULT_PLUGIN_HEALTH)
    return () => {}
  }

  const source = new EventSource(`${base}/plugin-health/${encodeURIComponent(workspaceId)}/stream`)
  source.onmessage = (event) => {
    try {
      onHealth(JSON.parse(event.data) as PluginHealth)
    } catch {
      // A malformed payload shouldn't crash the tablet - just skip this update.
    }
  }

  return () => source.close()
}
