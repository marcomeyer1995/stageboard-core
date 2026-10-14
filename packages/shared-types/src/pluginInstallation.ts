import { z } from 'zod'
import { CapabilityIdSchema } from './capability.js'
import { TransportDescriptorSchema } from './transport.js'
import { HardwareIdSchema } from './hardwareId.js'
import { DiscoveryTriggerSchema } from './discoveryTrigger.js'
import { CapabilityTimingSchema } from './timing.js'

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
  /** How Discovery Mode should ask a musician to physically identify this device when catalog
   * metadata alone can't tell two candidates apart (e.g. two guitarists' Kempers) - see
   * discoveryTrigger.ts. Absent for a plugin with no such action (or nothing that needs
   * disambiguating - a workspace rarely has two of the same server-only mixer, say). */
  discoveryTrigger: DiscoveryTriggerSchema.optional(),
  /** How precisely each of `capabilities` must land on the song time, whether its Translator
   * sends at `scheduledAt` itself, its known latency and how it can be calibrated (docs/21) - one
   * entry per capability that has an output. A capability without an entry is treated as class
   * `none`, acting on receipt; absent altogether on manifests installed before docs/21. */
  timing: z.array(CapabilityTimingSchema).optional(),
  enabled: z.boolean().default(true),
  installedAt: z.number().int().nonnegative(),
  /** The band's own settings for this plugin (e.g. piper-speech's voice, #63) - replicated with the
   * installation, so every device and the Stage-Server see the same. Free-form here; each plugin
   * parses its part with its own schema (speech.ts). */
  settings: z.record(z.string(), z.unknown()).optional(),
})
export type PluginInstallation = z.infer<typeof PluginInstallationSchema>
