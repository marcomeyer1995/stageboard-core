import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 1.5

export const NextSongConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
  /** "Aktuell: …" and "Next: …" each can be hidden (Marco, 2026-10-17: declutter - the current song
   * is already in the status bar). Unset = shown. */
  showCurrent: z.boolean().optional(),
  showNext: z.boolean().optional(),
})
export type NextSongConfig = z.infer<typeof NextSongConfigSchema>
