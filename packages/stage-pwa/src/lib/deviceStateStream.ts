import { DeviceStateEventSchema, type DeviceStateEvent } from 'shared-types'
import { getHostUrl } from './hostUrl'

/**
 * The live device state of the band (docs/36 §5a, #964): the host sends the latest value of every field a device add-on publishes - all of them at once
 * when this device connects, then every change. Same pattern as the presence stream: `EventSource` reconnects by itself, and each message is checked
 * (`DeviceStateEventSchema`) - a message that is not a value of a device is skipped, never drawn.
 */
export function subscribeToDeviceState(workspaceId: string, onEvent: (event: DeviceStateEvent) => void): () => void {
  const base = getHostUrl()
  if (!base || !workspaceId || typeof EventSource === 'undefined') return () => {}
  const source = new EventSource(`${base}/workspaces/${encodeURIComponent(workspaceId)}/device-state/stream`)
  source.onmessage = (message) => {
    try {
      const parsed = DeviceStateEventSchema.safeParse(JSON.parse(message.data))
      if (parsed.success) onEvent(parsed.data)
    } catch {
      // A malformed payload shouldn't crash the tablet - just skip this update.
    }
  }
  return () => source.close()
}
