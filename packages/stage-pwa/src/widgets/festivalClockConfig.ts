import { z } from 'zod'

export const DEFAULT_SIZE_RATIO = 2.5

export const FestivalClockConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type FestivalClockConfig = z.infer<typeof FestivalClockConfigSchema>
