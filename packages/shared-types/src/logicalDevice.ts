import { z } from 'zod'
import { CapabilityIdSchema } from './capability.js'
import { ExecutionTargetSchema } from './executionTarget.js'

/**
 * A named piece of gear a widget/cue targets - e.g. "Marco's Kemper". Both a *role*
 * (`name`/`capability`, independent of any particular physical unit) and, as of the guided
 * Hardware Setup Wizard redesign, its one live binding: `pluginId` (which installed plugin
 * fulfills it - the wizard's "type" step) and `executionTarget` (which tablet or the Stage-Server
 * actually runs it - the wizard's "connection" step). Earlier versions of this schema kept that
 * routing in a separate, named-and-switchable `HardwareSetup` (multiple swappable configs, e.g.
 * "Festival" vs "Acoustic Solo") - deliberately dropped (Marco, explicit call): one live setup
 * only, going forward. A future "snapshot the whole hardware setup, reload it later" feature is
 * the intended path back to something Setup-like, not a revival of per-Setup binding swapping.
 *
 * `pluginId`/`executionTarget` are nullable so a Logical Device can exist in a partially-set-up
 * state (the wizard's "skip for now, the gear isn't at hand yet" path) - a widget/cue simply
 * treats an unset one exactly like "nothing bound" (`hardwareRouting.ts`'s `resolveHardwareEngine`
 * already does, unchanged).
 *
 * `capability` stays a stored field (set once from the chosen plugin's own `capabilities[0]`),
 * not derived live from `pluginId` - so a Logical Device stays resolvable by capability even if
 * its plugin is later uninstalled, and `ShowCue` (showCue.ts, #99) can keep targeting a
 * LogicalDeviceId directly, resolved via `resolveHardwareBindingById` (hardwareRouting.ts).
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
  pluginId: z.string().min(1).nullable().default(null),
  executionTarget: ExecutionTargetSchema.nullable().default(null),
})
export type LogicalDevice = z.infer<typeof LogicalDeviceSchema>
