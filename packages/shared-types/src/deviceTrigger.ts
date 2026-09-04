import { z } from 'zod'
import { ShowControlEventSchema } from './plugin.js'

/**
 * Body relayed through the Stage-Server to a specific device's own trigger-stream (#10's
 * device-claim generalization) - for a capability whose execution target is a claimed tablet
 * rather than a Stage-Server plugin. Unlike `ShowState`'s continuous, synced fields (e.g.
 * `playbackStatus`, which every tablet already watches and can react to on its own), a cue
 * fire (Quick Actions, Lighting Cues) is a one-shot event with no natural "current state" to
 * sync - it genuinely needs delivering to the one device that's claimed, once, right now. See
 * `deviceRelay.ts` (core-backend) for the actual relay.
 */
export const DeviceTriggerSchema = z.object({
  /** Which capability this trigger is for - the receiving device needs this to know which
   * local mock engine (or eventually real hardware plugin) should handle it; the relay itself
   * is capability-agnostic. */
  capability: z.string().min(1),
  event: ShowControlEventSchema,
})
export type DeviceTrigger = z.infer<typeof DeviceTriggerSchema>
