import { deliverInBackground, dropFromInbox } from './inbox'
import { EMPTY_DISCOVERY_SESSION, type DiscoverySession } from 'shared-types'
import { getHostUrl } from './hostUrl'

/**
 * Server-Sent Events stream of the workspace's Discovery Mode session (discoverySessionStore.ts,
 * core-backend) - same pattern as presenceStream.ts: the host pushes the *full* snapshot on
 * every change, so no merge logic needed here, and `EventSource` retries dropped connections on
 * its own. No Host configured means there's nothing to subscribe to - Discovery Mode
 * needs the host as its coordinator, so the caller just keeps the default (inactive) session.
 */
export function subscribeToDiscovery(workspaceId: string, onSession: (session: DiscoverySession) => void): () => void {
  const base = getHostUrl()
  // No band yet (the native app paired with a host before joining, #348): nothing to subscribe to.
  if (!base || !workspaceId) {
    onSession(EMPTY_DISCOVERY_SESSION)
    return () => {}
  }

  const source = new EventSource(`${base}/workspaces/${encodeURIComponent(workspaceId)}/discovery/stream`)
  // A status, not a cue: applied in free time, the newest wins (docs/26 §3.1).
  const channel = `discovery:${workspaceId}`
  source.onmessage = (event) => {
    try {
      deliverInBackground(channel, JSON.parse(event.data) as DiscoverySession, onSession)
    } catch {
      // A malformed payload shouldn't crash the tablet - just skip this update.
    }
  }

  return () => {
    dropFromInbox(channel)
    source.close()
  }
}
