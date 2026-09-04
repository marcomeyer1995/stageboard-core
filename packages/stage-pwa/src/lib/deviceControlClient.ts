import type { ShowControlEvent, ShowControlResult } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/** Fires a device-claim trigger through the Stage-Server relay (#10, generalized beyond audio -
 * see deviceRelay.ts) at whichever tablet is currently claimed for `capability`, rather than a
 * Stage-Server plugin - same error-handling shape as showControlClient.ts's triggerShowControl. */
export async function triggerDeviceControl(
  workspaceId: string,
  deviceId: string,
  capability: string,
  event: ShowControlEvent,
): Promise<ShowControlResult> {
  const base = getStageServerUrl()
  if (!base) return { status: 'error', message: 'VITE_STAGE_SERVER_URL is not configured' }

  try {
    const response = await fetch(`${base}/workspaces/${workspaceId}/devices/${deviceId}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability, event }),
    })
    const body = (await response.json()) as ShowControlResult
    if (!response.ok) return { status: 'error', message: body.message ?? `HTTP ${response.status}` }
    return body
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
