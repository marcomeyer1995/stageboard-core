import { z } from 'zod'

/**
 * One tablet's own transport wiring for one Logical Device (#100) - which literal WebMIDI
 * port, USB device, or IP:port this specific tablet uses, for a Logical Device some
 * HardwareSetup binding assigns to it. Keyed by `${deviceId}:${logicalDeviceId}` so it's
 * unambiguous even if this device is ever bound for more than one Logical Device.
 *
 * Replicates like everything else here (so e.g. a future "Hardware Routing Matrix" dashboard
 * can see it), but is only ever meaningfully *editable* from `deviceId` itself - a browser can
 * only enumerate what's physically attached to it, not to some other tablet. Enforced
 * client-side only, same spirit as Dashboard's `visibility: 'private'`.
 */
export const DeviceTransportConfigSchema = z.object({
  id: z.string().min(1),
  deviceId: z.string().min(1),
  logicalDeviceId: z.string().min(1),
  /** Which of the responsible plugin's declared TransportDescriptors this is - null until the
   * device picks one. */
  transportId: z.string().nullable(),
  /** Raw field values keyed by TransportField.key - e.g. `{ midiOutputId: '...' }`. Not
   * consumed by anything yet; #101's client-plugin execution is the eventual reader. */
  values: z.record(z.string(), z.string()).default({}),
})
export type DeviceTransportConfig = z.infer<typeof DeviceTransportConfigSchema>
