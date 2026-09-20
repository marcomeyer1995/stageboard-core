import { z } from 'zod'

export const DEFAULT_SIZE_RATIO = 1

export const LoopTrainerConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type LoopTrainerWidgetConfig = z.infer<typeof LoopTrainerConfigSchema>
