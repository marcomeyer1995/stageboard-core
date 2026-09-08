import { DEFAULT_DEVICE_INFO, type DeviceInfo } from 'shared-types'
import { getStageServerUrl } from './stageServer'

/**
 * Server-Sent Events stream of the Device Ledger's live diagnostic data - same pattern as
 * presenceStream.ts, a separate instance rather than widening presence (deviceInfo.ts's own
 * doc comment explains why). The Stage-Server pushes the *full* snapshot on every change, so
 * there is no merge logic here - just replace.
 *
 * `EventSource` retries dropped connections on its own - no explicit reconnect/backoff logic
 * needed. No `VITE_STAGE_SERVER_URL` means there is nothing to subscribe to - the caller just
 * keeps the default (empty) snapshot.
 */
export function subscribeToDeviceInfo(workspaceId: string, onDeviceInfo: (deviceInfo: DeviceInfo) => void): () => void {
  const base = getStageServerUrl()
  if (!base) {
    onDeviceInfo(DEFAULT_DEVICE_INFO)
    return () => {}
  }

  const source = new EventSource(`${base}/workspaces/${encodeURIComponent(workspaceId)}/device-info/stream`)
  source.onmessage = (event) => {
    try {
      onDeviceInfo(JSON.parse(event.data) as DeviceInfo)
    } catch {
      // A malformed payload shouldn't crash the tablet - just skip this update.
    }
  }

  return () => source.close()
}
