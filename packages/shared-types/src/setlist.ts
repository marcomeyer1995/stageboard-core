import { z } from 'zod'

export const TRANSITION_TYPES = ['manual', 'next-ready', 'seamless', 'delayed'] as const
export type TransitionType = (typeof TRANSITION_TYPES)[number]
export const DEFAULT_TRANSITION_DELAY_MS = 8000

/**
 * One occurrence of a song in a setlist. A distinct `id` (not just the songId) is what lets
 * the same song appear twice with two different variants selected - e.g. the full version
 * early in the set and a shortened "Kurzfassung" as the encore - since a plain songId can't
 * distinguish which occurrence is which.
 */
export const SetlistEntrySchema = z.object({
  id: z.string().min(1),
  songId: z.string().min(1),
  /** null = play this song's isDefault variant. */
  variantId: z.string().nullable(),
  /** null = this variant's default track (its `band-mix` track if it has one, else its
   * first track) - see resolveTrackForEntry in stage-pwa's computeQueue.ts. The setlist's own
   * choice of backing track (e.g. "no guitar" vs "full band" for tonight's lineup), separate
   * from a per-device override for one specific show (TrackOverrideWidget). */
  trackId: z.string().nullable(),
  /** What happens when this entry's backing track reaches its scheduled end (#232, see
   * TRANSITION_TYPES): `manual` (default) just stops, `next-ready` stops and arms the next entry,
   * `seamless` starts the next entry immediately with no count-in, `delayed` starts it after
   * `transitionDelayMs` (absent = DEFAULT_TRANSITION_DELAY_MS) with its normal count-in. Legacy
   * documents without the field behave as `manual` (no migration needed). */
  transitionType: z.enum(TRANSITION_TYPES).optional(),
  /** Only meaningful for `transitionType: 'delayed'` - the pause before the next entry starts. */
  transitionDelayMs: z.number().int().nonnegative().optional(),
})
export type SetlistEntry = z.infer<typeof SetlistEntrySchema>

export const SetlistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  entries: z.array(SetlistEntrySchema),
  /** Drives the Bibliothek's "newest first" ordering (#20 follow-up). Defaults to 0 for
   * setlists that predate this field - they simply sort as the oldest, which is correct:
   * no migration needed, nothing before this field genuinely has a creation time to recover. */
  createdAt: z.number().int().nonnegative().default(0),
})
export type Setlist = z.infer<typeof SetlistSchema>
