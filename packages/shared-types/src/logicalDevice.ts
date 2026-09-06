import { z } from 'zod'
import { CapabilityIdSchema } from './capability.js'

/**
 * A named abstract device a widget/cue can target - e.g. "Marco's Kemper" - independent of
 * which physical tablet/server currently executes its capability. #10 (Logical Devices &
 * Hardware Setup Profiles), second schema after DeviceRegistry (device.ts): DeviceRegistry
 * names *physical* hardware (this tablet, that server); a LogicalDevice names a *role* a widget
 * binds to once and never has to touch again, even as the physical routing behind it changes
 * from gig to gig.
 *
 * That routing (LogicalDeviceId -> ExecutionTarget + pluginId) is `HardwareSetup`
 * (hardwareSetup.ts). `ShowCue` (showCue.ts, #99) already targets a LogicalDeviceId directly,
 * resolved via `resolveHardwareBindingById` (hardwareRouting.ts, #102's cue scheduler) - true
 * per-LogicalDeviceId targeting for `WidgetInstance` and today's four capability-routed widgets
 * still resolves a capability's *first* matching Logical Device instead (`resolveHardwareBinding`,
 * same file), not yet wired to a specific id.
 *
 * One capability per Logical Device, matching the issue's example ("Marco's Kemper" /
 * `midi-input`) - a piece of hardware that offers several capabilities (e.g. a Kemper that's
 * both a MIDI target and an audio source) becomes multiple Logical Devices for now, not one
 * multi-capability entry.
 */
export const LogicalDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  capability: CapabilityIdSchema,
})
export type LogicalDevice = z.infer<typeof LogicalDeviceSchema>
