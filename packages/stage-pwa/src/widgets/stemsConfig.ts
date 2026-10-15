import { z } from 'zod'

export const DEFAULT_SIZE_RATIO = 0.9

export const StemsConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type StemsConfig = z.infer<typeof StemsConfigSchema>
