import type { ShowControlEvent, ShowControlResult } from 'shared-types'
import { hostText } from './hostMessage'
import { getHostUrl, NO_HOST_MESSAGE } from './hostUrl'

/** Fires a trigger through the Host relay (#10 - see deviceRelay.ts) at whichever
 * tablet the active HardwareSetup binds `capability` to, rather than a Host plugin -
 * same error-handling shape as showControlClient.ts's triggerShowControl. */
export async function triggerDeviceControl(
  workspaceId: string,
  deviceId: string,
  capability: string,
  event: ShowControlEvent,
): Promise<ShowControlResult> {
  const base = getHostUrl()
  if (!base) return { status: 'error', message: NO_HOST_MESSAGE }

  try {
    const response = await fetch(`${base}/workspaces/${workspaceId}/devices/${deviceId}/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capability, event }),
    })
    const body = (await response.json()) as ShowControlResult
    if (!response.ok) return { status: 'error', message: hostText(body) ?? `HTTP ${response.status}` }
    // A plugin's own error (OSC, Demucs, ...) comes with status 200 - in this device's language too (#679).
    return body.status === 'error' ? { ...body, message: hostText(body) } : body
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
