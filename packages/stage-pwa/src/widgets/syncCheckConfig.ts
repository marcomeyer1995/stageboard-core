import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 2

export const SyncCheckConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type SyncCheckConfig = z.infer<typeof SyncCheckConfigSchema>
