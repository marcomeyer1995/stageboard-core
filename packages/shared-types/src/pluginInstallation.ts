import { z } from 'zod'
import { CapabilityIdSchema } from './capability.js'

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
  /** Repository the plugin came from, for the later code-loading step. */
  source: z.string().optional(),
  runtime: PluginRuntimeSchema,
  capabilities: z.array(CapabilityIdSchema).default([]),
  enabled: z.boolean().default(true),
  installedAt: z.number().int().nonnegative(),
})
export type PluginInstallation = z.infer<typeof PluginInstallationSchema>
