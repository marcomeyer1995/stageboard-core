import type { PluginStatus } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/**
 * POSTs a client-runtime plugin's current status (e.g. WebMIDI, whose reachability only this
 * tablet can know) to the Stage-Server, which relays it to every other tablet over
 * pluginHealthStream.ts - the tablet-originated counterpart to the Stage-Server's own
 * heartbeat for plugins it hosts itself. Some hardware is tablet-hosted from the lowest tier
 * up (docs/02), so health can legitimately originate from either side.
 *
 * Best-effort: if the Stage-Server is unreachable, this tablet's own capability resolution
 * still works via its local probe untouched (see useCapabilities.ts) - only other tablets
 * miss out on knowing about it.
 */
export async function reportClientHealth(
  workspaceId: string,
  pluginName: string,
  status: PluginStatus,
): Promise<void> {
  const base = getStageServerUrl()
  if (!base) return

  try {
    await fetch(`${base}/plugin-health/${encodeURIComponent(workspaceId)}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pluginName, status }),
    })
  } catch {
    // Network failure or server down - nothing to recover from here, see doc comment above.
  }
}
