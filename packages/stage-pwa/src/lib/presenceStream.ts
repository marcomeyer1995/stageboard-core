import { deliverInBackground, dropFromInbox } from './inbox'
import { DEFAULT_PRESENCE, type Presence } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/**
 * Server-Sent Events stream of "who's currently logged in, from how many devices" for one
 * workspace - same pattern as pluginHealthStream.ts. The Stage-Server pushes the *full*
 * snapshot on every change, so there is no merge logic here - just replace.
 *
 * `EventSource` retries dropped connections on its own (a browser built-in) - no explicit
 * reconnect/backoff logic needed. No `VITE_STAGE_SERVER_URL` (e.g. Tier 1 "Solo," no server
 * at all) means there is nothing to subscribe to - the caller just keeps the default (empty)
 * presence.
 */
export function subscribeToPresence(workspaceId: string, onPresence: (presence: Presence) => void): () => void {
  const base = getStageServerUrl()
  // No band yet (the native app paired with a server before joining, #348): nothing to subscribe to.
  if (!base || !workspaceId) {
    onPresence(DEFAULT_PRESENCE)
    return () => {}
  }

  const source = new EventSource(`${base}/workspaces/${encodeURIComponent(workspaceId)}/presence/stream`)
  // A status, not a cue: applied in free time, the newest wins (docs/26 §3.1).
  const channel = `presence:${workspaceId}`
  source.onmessage = (event) => {
    try {
      deliverInBackground(channel, JSON.parse(event.data) as Presence, onPresence)
    } catch {
      // A malformed payload shouldn't crash the tablet - just skip this update.
    }
  }

  return () => {
    dropFromInbox(channel)
    source.close()
  }
}
