import { z } from 'zod'

/**
 * A capability's available/degraded/missing status, duplicated here rather than shared
 * with packages/stage-pwa/src/lib/capabilities.ts's CapabilityStatus type (frontend-only,
 * not worth relocating for three literal strings unlikely to drift).
 */
const CapabilityStatusValueSchema = z.enum(['available', 'degraded', 'missing'])

/**
 * One event in a show's history. A "show" is simply every event sharing one `showId` -
 * there is no separate summary document, so there's nothing to keep in sync.
 *
 * Detection (which show is running, whether a song stayed active long enough to count as
 * "played", capability transitions) happens client-side, gated to whichever tablet holds
 * the Master-Token (see useShowLogTracker.ts) - the same trust primitive ShowState's
 * setActiveSong already uses, so only one tablet ever writes these at a time. `note`
 * events are the one exception: any device can add one, not just the master.
 */
export const ShowLogEventSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('show-started'),
    at: z.number().int().nonnegative(),
  }),
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('song-played'),
    /** When the song became active. */
    at: z.number().int().nonnegative(),
    /** When the next song started - StageBoard has no playback engine, so this is the
     * only "song ended" signal that exists; see docs/07 for the deferred Pause/Stop idea
     * that would make a real gap between songs detectable. */
    endedAt: z.number().int().nonnegative(),
    songId: z.string().min(1),
    /** Denormalized so the report still reads right if the song is later renamed/deleted. */
    songTitle: z.string().min(1),
  }),
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('capability-changed'),
    at: z.number().int().nonnegative(),
    capability: z.string().min(1),
    from: CapabilityStatusValueSchema,
    to: CapabilityStatusValueSchema,
  }),
  z.object({
    id: z.string().min(1),
    showId: z.string().min(1),
    type: z.literal('note'),
    at: z.number().int().nonnegative(),
    text: z.string().min(1),
    authorProfileId: z.string().nullable(),
  }),
])
export type ShowLogEvent = z.infer<typeof ShowLogEventSchema>
