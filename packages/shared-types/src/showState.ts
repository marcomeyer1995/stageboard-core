import { z } from 'zod'

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
})
export type ShowState = z.infer<typeof ShowStateSchema>

export const DEFAULT_SHOW_STATE: ShowState = {
  activeSetlistId: null,
  activeEntryId: null,
  masterHolderId: null,
  masterClaimedAt: null,
}
