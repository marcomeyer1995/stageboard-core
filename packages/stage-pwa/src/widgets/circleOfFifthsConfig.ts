import { z } from 'zod'

export const DEFAULT_SIZE_RATIO = 1

export const CircleOfFifthsConfigSchema = z.object({
  noteNaming: z.enum(['sharp', 'flat']).default('sharp'),
  sizeRatio: z.number().positive().optional(),
})
export type CircleOfFifthsConfig = z.infer<typeof CircleOfFifthsConfigSchema>
