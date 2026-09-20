import { getStageServerUrl } from './stageServer'

/** POSTs "the Master-Token holder is still alive" (#32) - best-effort like reportPresence.ts: if
 * the Stage-Server is unreachable, the other tablets simply see this master go stale, which is
 * exactly what they should do. */
export async function reportMasterHeartbeat(workspaceId: string, deviceId: string): Promise<void> {
  const base = getStageServerUrl()
  if (!base) return

  try {
    await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}/master-heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    })
  } catch {
    // Network failure or server down - see doc comment above.
  }
}
