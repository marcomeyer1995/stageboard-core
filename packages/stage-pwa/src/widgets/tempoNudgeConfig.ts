import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 2.2

export const TempoNudgeConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type TempoNudgeConfig = z.infer<typeof TempoNudgeConfigSchema>
