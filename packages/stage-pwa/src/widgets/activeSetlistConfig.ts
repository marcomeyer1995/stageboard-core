import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 1.5

export const ActiveSetlistConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type ActiveSetlistConfig = z.infer<typeof ActiveSetlistConfigSchema>
