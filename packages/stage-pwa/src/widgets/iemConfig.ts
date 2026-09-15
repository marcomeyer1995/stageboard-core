import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 0.9

export const IemConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type IemConfig = z.infer<typeof IemConfigSchema>
