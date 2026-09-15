import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default
 * (18px) - a small glanceable status row, not a primary focal point. */
export const DEFAULT_SIZE_RATIO = 1.3

export const BackupStatusConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type BackupStatusConfig = z.infer<typeof BackupStatusConfigSchema>
