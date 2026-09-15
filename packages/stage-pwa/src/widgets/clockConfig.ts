import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default - a
 * prominent wall-clock readout. */
export const DEFAULT_SIZE_RATIO = 3

export const ClockConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type ClockConfig = z.infer<typeof ClockConfigSchema>
