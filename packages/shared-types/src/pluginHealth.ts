import { z } from 'zod'

export const PluginStatusSchema = z.enum(['online', 'offline', 'error'])
export type PluginStatus = z.infer<typeof PluginStatusSchema>

export const PluginHealthEntrySchema = z.object({
  status: PluginStatusSchema,
  /** Epoch ms of the last heartbeat. Stale means offline - see HEALTH_TIMEOUT_MS. */
  lastSeenAt: z.number().int().nonnegative(),
  message: z.string().optional(),
})
export type PluginHealthEntry = z.infer<typeof PluginHealthEntrySchema>

/**
 * Runtime health of the server-side plugins, written by the Stage-Server and read by
 * every tablet. Separate from PluginInstallation on purpose: "installed" is a property
 * of the band, "reachable" is a property of tonight's venue (docs/07 Graceful Degradation).
 */
export const PluginHealthSchema = z.object({
  plugins: z.record(z.string(), PluginHealthEntrySchema).default({}),
})
export type PluginHealth = z.infer<typeof PluginHealthSchema>

export const DEFAULT_PLUGIN_HEALTH: PluginHealth = { plugins: {} }

/**
 * How long a heartbeat stays valid. Nobody writes "offline" when the Stage-Server dies,
 * so a stale entry is the only signal the tablets get - and it has to be one.
 */
export const HEALTH_TIMEOUT_MS = 15_000
