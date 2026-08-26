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
})
export type Setlist = z.infer<typeof SetlistSchema>
