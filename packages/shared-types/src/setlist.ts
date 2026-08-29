import { z } from 'zod'

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
