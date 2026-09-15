import { z } from 'zod'

/** Roughly matches CueGrid's previous typical auto-fit size at the device default - shared
 * by QuickActionsWidget and LightingCuesWidget, the two callers of CueGrid. */
export const DEFAULT_SIZE_RATIO = 1.1

export const CueGridConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type CueGridConfig = z.infer<typeof CueGridConfigSchema>
