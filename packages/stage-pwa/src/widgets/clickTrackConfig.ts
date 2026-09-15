import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 3

export const ClickTrackConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type ClickTrackConfig = z.infer<typeof ClickTrackConfigSchema>
