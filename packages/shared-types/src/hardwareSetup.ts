import { z } from 'zod'

/** Routes to a Stage-Server-hosted plugin instead of a specific tablet - today's default
 * behavior (before #10 existed at all), now expressed as one reserved `ExecutionTarget` value
 * rather than "this capability has no binding". */
export const SERVER_EXECUTION_TARGET = 'server'

/** 'server' (see above) or a specific tablet's `Device.id` (device.ts). */
export const ExecutionTargetSchema = z.string().min(1)
export type ExecutionTarget = z.infer<typeof ExecutionTargetSchema>

/** Where one Logical Device is actually executed under a given HardwareSetup, and how - the
 * transport-specific bits (IP, MIDI port, ...) live in `pluginConfig` as an open bag, since this
 * schema doesn't know which transport a given capability uses. */
export const HardwareBindingSchema = z.object({
  executionTarget: ExecutionTargetSchema,
  pluginConfig: z.record(z.string(), z.unknown()).optional(),
})
export type HardwareBinding = z.infer<typeof HardwareBindingSchema>

/**
 * A named, switchable rig configuration - #10's HardwareSetup. E.g. "Festival" binds "Marco's
 * Kemper" (a LogicalDeviceId, logicalDevice.ts) to `SERVER_EXECUTION_TARGET` via the
 * Stage-Server's OSC plugin; "Acoustic Solo" binds the same Logical Device to Marco's own
 * tablet via USB WebMIDI instead. The UI widget bound to "Marco's Kemper" never changes; only
 * which HardwareSetup is active does (ShowState.activeHardwareSetupId).
 *
 * Keyed by LogicalDeviceId rather than capability, unlike the `deviceClaims` map this replaces,
 * so two Logical Devices sharing one capability (two Kempers) can eventually get independent
 * bindings, once WidgetInstance/ShowCue target a LogicalDeviceId directly (#10, not yet wired -
 * today's widgets still resolve a capability's *first* matching Logical Device, same tie-break
 * `pluginProviding` already uses for plugins).
 */
export const HardwareSetupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  bindings: z.record(z.string(), HardwareBindingSchema),
})
export type HardwareSetup = z.infer<typeof HardwareSetupSchema>
