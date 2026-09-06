import { z } from 'zod'
import { ShowControlEventSchema } from './plugin.js'

/**
 * A show-hardware command anchored to a point in a song's timeline, addressed to a specific
 * Logical Device (#10/#99) - e.g. a Kemper rig change at bar 32, sent to "Guitarist 1's Kemper"
 * specifically, not "whichever mixer is around." Two Logical Devices sharing a capability (two
 * guitarists, two Kempers) can each carry independent cues in the same song, since the target
 * is a `LogicalDeviceId`, never a bare capability.
 *
 * Reuses `ShowControlEventSchema`'s `type`/`payload` shape rather than inventing a new payload
 * format - the same event a plugin's `trigger`/Translator already knows how to handle, just
 * scheduled ahead of time instead of fired ad hoc. `scheduledAt` is dropped: that's an absolute
 * wall-clock dispatch timestamp the Show Control Gateway computes at fire time (docs/00 §4),
 * not something authored into the song data.
 */
export const ShowCueSchema = ShowControlEventSchema.omit({ scheduledAt: true }).extend({
  id: z.string().min(1),
  /** Song-relative, like `TimecodeMarker.timeMs` (song.ts) - not a wall-clock timestamp. The
   * runtime scheduler (#102) computes the actual dispatch time from this plus the synced
   * playback start. */
  timeMs: z.number().int().nonnegative(),
  /** WHO receives this cue, not WHAT it does - #10's whole point. */
  targetLogicalDeviceId: z.string().min(1),
})
export type ShowCue = z.infer<typeof ShowCueSchema>
