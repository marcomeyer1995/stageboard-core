import { z } from 'zod'

export const DEFAULT_SIZE_RATIO = 0.9

export const AudioMixConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type AudioMixConfig = z.infer<typeof AudioMixConfigSchema>
