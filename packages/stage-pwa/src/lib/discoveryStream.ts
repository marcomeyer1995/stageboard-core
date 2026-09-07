import { EMPTY_DISCOVERY_SESSION, type DiscoverySession } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/**
 * Server-Sent Events stream of the workspace's Discovery Mode session (discoverySessionStore.ts,
 * core-backend) - same pattern as presenceStream.ts: the server pushes the *full* snapshot on
 * every change, so no merge logic needed here, and `EventSource` retries dropped connections on
 * its own. No Stage-Server configured means there's nothing to subscribe to - Discovery Mode
 * needs the server as its coordinator, so the caller just keeps the default (inactive) session.
 */
export function subscribeToDiscovery(workspaceId: string, onSession: (session: DiscoverySession) => void): () => void {
  const base = getStageServerUrl()
  if (!base) {
    onSession(EMPTY_DISCOVERY_SESSION)
    return () => {}
  }

  const source = new EventSource(`${base}/workspaces/${encodeURIComponent(workspaceId)}/discovery/stream`)
  source.onmessage = (event) => {
    try {
      onSession(JSON.parse(event.data) as DiscoverySession)
    } catch {
      // A malformed payload shouldn't crash the tablet - just skip this update.
    }
  }

  return () => source.close()
}
