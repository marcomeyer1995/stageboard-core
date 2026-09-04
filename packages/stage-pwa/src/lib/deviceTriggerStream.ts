import type { DeviceTrigger } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/**
 * Server-Sent Events stream of device-claim triggers relayed at *this* device (#10, generalized
 * beyond audio - see deviceRelay.ts, core-backend). Same pattern as presenceStream.ts/
 * pluginHealthStream.ts: `EventSource` retries dropped connections on its own, and no
 * `VITE_STAGE_SERVER_URL` means there's nothing to subscribe to.
 */
export function subscribeToDeviceTriggers(
  workspaceId: string,
  deviceId: string,
  onTrigger: (trigger: DeviceTrigger) => void,
): () => void {
  const base = getStageServerUrl()
  if (!base) return () => {}

  const source = new EventSource(
    `${base}/workspaces/${encodeURIComponent(workspaceId)}/devices/${encodeURIComponent(deviceId)}/trigger-stream`,
  )
  source.onmessage = (event) => {
    try {
      onTrigger(JSON.parse(event.data) as DeviceTrigger)
    } catch {
      // A malformed payload shouldn't crash the tablet - just skip this update.
    }
  }

  return () => source.close()
}
