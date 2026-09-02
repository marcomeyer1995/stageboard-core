import { z } from 'zod'
import type { CapabilityId } from './capability.js'

export interface PluginContext {
  log: {
    info: (msg: string, meta?: Record<string, unknown>) => void
    error: (msg: string, meta?: Record<string, unknown>) => void
  }
}

export interface IPlugin {
  name: string
  version: string
  /** What this plugin enables in the UI - the same vocabulary widgets declare in `requires`. */
  capabilities: CapabilityId[]
  init(context: PluginContext): Promise<void> | void
  shutdown?(): Promise<void> | void
}

export const ShowControlEventSchema = z.object({
  type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional(),
  /** Ahead-of-time dispatch (docs/00 §4): a synchronized-clock timestamp (see
   * clockSync.ts's `getServerTime()`) to fire at, rather than immediately on receipt - the
   * Show Control Gateway delays the actual plugin trigger until this timestamp, absorbing
   * per-device network jitter instead of every tablet firing the instant its own packet
   * arrives. Gateway-only concern: stripped before the event reaches `IShowControlPlugin`. */
  scheduledAt: z.number().int().nonnegative().optional(),
})
export type ShowControlEvent = z.infer<typeof ShowControlEventSchema>

export const ShowControlResultSchema = z.object({
  status: z.enum(['ok', 'error']),
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
})
export type ShowControlResult = z.infer<typeof ShowControlResultSchema>

/**
 * A hardware-facing plugin (mixer, lighting, ...) driven through the Show Control
 * Gateway. Real plugins wrap a device SDK/protocol; test/dev plugins can be pure
 * mocks (see docs/03_Developer_Experience.md's hardware-mock strategy) - the
 * gateway and every caller only ever depend on this interface, never on the
 * concrete hardware.
 */
export interface IShowControlPlugin extends IPlugin {
  trigger(event: ShowControlEvent): Promise<ShowControlResult> | ShowControlResult
}
