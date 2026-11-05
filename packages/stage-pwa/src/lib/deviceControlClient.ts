import type { ShowControlEvent, ShowControlResult } from 'shared-types'
import { serverText } from './serverMessage'
import { getStageServerUrl, NO_STAGE_SERVER_MESSAGE } from './stageServer'

/** Fires a trigger through the Stage-Server relay (#10 - see deviceRelay.ts) at whichever
 * tablet the active HardwareSetup binds `capability` to, rather than a Stage-Server plugin -
 * same error-handling shape as showControlClient.ts's triggerShowControl. */
export async function triggerDeviceControl(
  workspaceId: string,
  deviceId: string,
  capability: string,
  event: ShowControlEvent,
): Promise<ShowControlResult> {
  const base = getStageServerUrl()
  if (!base) return { status: 'error', message: NO_STAGE_SERVER_MESSAGE }

  try {
    const response = await fetch(`${base}/workspaces/${workspaceId}/devices/${deviceId}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability, event }),
    })
    const body = (await response.json()) as ShowControlResult
    if (!response.ok) return { status: 'error', message: serverText(body) ?? `HTTP ${response.status}` }
    // A plugin's own error (OSC, Demucs, ...) comes with status 200 - in this device's language too (#679).
    return body.status === 'error' ? { ...body, message: serverText(body) } : body
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
