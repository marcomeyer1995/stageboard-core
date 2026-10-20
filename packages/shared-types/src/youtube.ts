import { z } from 'zod'

/** One hit of the Stage-Server's YouTube search (#618) - what the "Track hinzufügen" dialog lists. */
export const YoutubeSearchResultSchema = z.object({
  /** YouTube's 11-character video id - also the key for the server's thumbnail proxy. */
  id: z.string(),
  title: z.string(),
  channel: z.string().nullable(),
  durationSec: z.number().nullable(),
  url: z.string(),
})
export type YoutubeSearchResult = z.infer<typeof YoutubeSearchResultSchema>

/** A YouTube video id - the only thing the thumbnail proxy accepts. */
export const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
