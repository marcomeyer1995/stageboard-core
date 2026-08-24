import { z } from 'zod'

/**
 * Singleton, per-workspace synced doc: which setlist/song is currently active,
 * and who (which tablet) holds the Master-Token. All tablets in a workspace
 * read this; only the current token holder is expected to write it.
 */
export const ShowStateSchema = z.object({
  activeSetlistId: z.string().nullable(),
  activeSongId: z.string().nullable(),
  masterHolderId: z.string().nullable(),
  masterClaimedAt: z.number().nullable(),
})
export type ShowState = z.infer<typeof ShowStateSchema>

export const DEFAULT_SHOW_STATE: ShowState = {
  activeSetlistId: null,
  activeSongId: null,
  masterHolderId: null,
  masterClaimedAt: null,
}
