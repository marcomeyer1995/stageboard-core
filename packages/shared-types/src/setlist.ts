import { z } from 'zod'

export const SetlistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  songIds: z.array(z.string()),
})
export type Setlist = z.infer<typeof SetlistSchema>
