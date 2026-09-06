import { z } from 'zod'

/**
 * One config field a transport needs (#100) - e.g. `usb-midi` needs a `midiOutputId`,
 * `network-osc` needs `host`/`port`. Purely descriptive (label + a plain HTML input type),
 * not a validated schema in its own right: the actual values a device fills in
 * (DeviceTransportConfig, deviceTransportConfig.ts) are stored as plain strings and aren't
 * consumed by anything yet - #101's real client-plugin execution is what will eventually read
 * them.
 */
export const TransportFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'number']).default('text'),
})
export type TransportField = z.infer<typeof TransportFieldSchema>

/**
 * A transport a plugin supports, and the fields its config needs - declared by the plugin
 * itself (PluginInstallation.transports), not by a HardwareBinding: which literal MIDI
 * port/USB device/IP a given tablet actually uses can only be picked *on that tablet*
 * (DeviceTransportConfig), never from a remote admin screen.
 */
export const TransportDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(TransportFieldSchema).default([]),
})
export type TransportDescriptor = z.infer<typeof TransportDescriptorSchema>
