import type { ShowStatePush, ShowStatePushAck } from 'shared-types'
import { getStageServerUrl } from './stageServer'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * The fast lane for the master's show-state changes (#468): Play, Pause, Stop, Weiter are pushed
 * through the Stage-Server to every device at once. The database write stays the record and the
 * fallback - without a Stage-Server (Solo tier) or when this push fails, replication still delivers
 * the change, only later (up to 1 s from a slow tablet, measured 2026-10-10).
 */

function streamUrl(workspaceId: string, path: string): string | null {
  const base = getStageServerUrl()
  return base && workspaceId ? `${base}/workspaces/${encodeURIComponent(workspaceId)}/show-state/${path}` : null
}

/** Sends the change; never throws and never waits for the answer - the database write is the
 * reliable path, this one only makes it faster. Signed with this device's band login. */
export function pushShowState(workspaceId: string, push: ShowStatePush): void {
  const url = streamUrl(workspaceId, 'push')
  const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId)
  if (!url || !workspace?.username || !workspace.couchPassword) return
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${workspace.username}:${workspace.couchPassword}`)}` },
    body: JSON.stringify(push),
  }).catch(() => {})
}

/** Every change pushed for the band (also this device's own - the caller skips those). */
export function subscribeToShowStatePush(workspaceId: string, onPush: (push: ShowStatePush) => void): () => void {
  const url = streamUrl(workspaceId, 'stream')
  if (!url || typeof EventSource === 'undefined') return () => {}
  const source = new EventSource(url)
  source.onmessage = (event) => {
    try {
      onPush(JSON.parse(event.data) as ShowStatePush)
    } catch {
      // A malformed payload shouldn't crash the tablet - replication brings the change anyway.
    }
  }
  return () => source.close()
}

/** Tells the server when a change reached this device - logged there, the measurement behind PLAY_LEAD_MS. */
export function reportShowStateArrival(workspaceId: string, ack: ShowStatePushAck): void {
  const url = streamUrl(workspaceId, 'ack')
  if (!url) return
  void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ack) }).catch(() => {})
}
