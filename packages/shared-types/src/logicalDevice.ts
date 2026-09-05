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
 * That routing (LogicalDeviceId -> ExecutionTarget + PluginConfig) is `HardwareSetup`, not yet
 * built - showState.ts's `deviceClaims` remains today's single-map stand-in for it. This schema
 * is deliberately not yet referenced by WidgetInstance/ShowCue or any HardwareSetup; it only
 * gives a Logical Device somewhere to be named ahead of that routing layer existing.
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
