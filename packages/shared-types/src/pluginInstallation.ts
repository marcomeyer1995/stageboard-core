import { z } from 'zod'
import { CapabilityIdSchema } from './capability.js'
import { TransportDescriptorSchema } from './transport.js'
import { HardwareIdSchema } from './hardwareId.js'

/**
 * Where a plugin actually runs. WebMIDI is a browser API and therefore lives on the
 * tablet; a mixer adapter talks to hardware and lives on the Stage-Server. That
 * difference decides who reports the plugin's health (see pluginHealth.ts).
 */
export const PluginRuntimeSchema = z.enum(['client', 'server', 'both'])
export type PluginRuntime = z.infer<typeof PluginRuntimeSchema>

/**
 * A plugin the band has installed. This document is replicated per workspace, so
 * installing a plugin on one tablet distributes it across the whole stage mesh -
 * every other tablet and the Stage-Server pick it up through CouchDB replication.
 *
 * It carries the plugin's *manifest*, not its code; loading plugin code from a
 * GitHub repository (docs/01) is a later step.
 */
export const PluginInstallationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  /** Where the Stage-Server fetches this plugin's *server-side* code from, for #17's dynamic
   * code loading (not built yet). */
  source: z.string().optional(),
  /** Where a tablet fetches this plugin's *client-side* bundle from (#101) - an ES module
   * exporting a `ClientPluginModule` default (stage-pwa's `loadClientPlugin.ts`). Absent for a
   * plugin with nothing to run in the browser (e.g. a purely server-hosted mixer adapter). */
  clientSource: z.string().optional(),
  runtime: PluginRuntimeSchema,
  capabilities: z.array(CapabilityIdSchema).default([]),
  /** Transports this plugin can drive a device through, and what each one's config needs
   * (#100) - e.g. `usb-midi` needs a `midiOutputId`. Empty for a plugin with nothing to
   * configure (the mock plugins today). The actual per-tablet values live in
   * DeviceTransportConfig, never here - this is just what the *fields* are. */
  transports: z.array(TransportDescriptorSchema).default([]),
  /** Cheap identity metadata (#106) so a tablet can recognize a newly-connected WebMIDI/WebUSB
   * device that matches this plugin, without loading its code - see hardwareId.ts. Empty for a
   * plugin with nothing to auto-detect (the server-only mock plugins today). */
  hardwareIds: z.array(HardwareIdSchema).default([]),
  enabled: z.boolean().default(true),
  installedAt: z.number().int().nonnegative(),
})
export type PluginInstallation = z.infer<typeof PluginInstallationSchema>
