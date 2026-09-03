import { z } from 'zod'

/** One song occurrence currently being timed for the `song-played` 20-second confirmation
 * threshold (see useShowLogTracker.ts in stage-pwa). */
export const PendingSongSchema = z.object({
  /** The setlist entry this play-through belongs to - distinguishes two occurrences of the
   * same song (e.g. full version then a shortened encore) from one continuous play. */
  entryId: z.string(),
  songId: z.string(),
  songTitle: z.string(),
  startedAt: z.number(),
})
export type PendingSong = z.infer<typeof PendingSongSchema>

/**
 * Singleton, per-workspace synced doc: which setlist/song is currently active,
 * and who (which tablet) holds the Master-Token. All tablets in a workspace
 * read this; only the current token holder is expected to write it.
 */
export const ShowStateSchema = z.object({
  activeSetlistId: z.string().nullable(),
  /** The current SetlistEntry's id, not a bare songId - a songId alone can't tell which
   * occurrence is current when the same song appears twice in a setlist (e.g. full version
   * then a shortened encore). With no active setlist, computeQueue synthesizes one entry per
   * catalog song whose id equals the songId, so this still just works. */
  activeEntryId: z.string().nullable(),
  masterHolderId: z.string().nullable(),
  masterClaimedAt: z.number().nullable(),
  /** In-flight show-log tracking (useShowLogTracker.ts), persisted here rather than in each
   * tablet's own React refs - so a new Master-Token holder inherits an already-in-progress
   * song's true start time instead of losing the play record on a mid-song handoff (#4). */
  pendingSong: PendingSongSchema.nullable(),
  currentShowId: z.string().nullable(),
  lastActivityAt: z.number().nullable(),
})
export type ShowState = z.infer<typeof ShowStateSchema>

export const DEFAULT_SHOW_STATE: ShowState = {
  activeSetlistId: null,
  activeEntryId: null,
  masterHolderId: null,
  masterClaimedAt: null,
  pendingSong: null,
  currentShowId: null,
  lastActivityAt: null,
}
