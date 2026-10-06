import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 1.3

export const DashboardSwitcherConfigSchema = z.object({
  orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
  sizeRatio: z.number().positive().optional(),
})
export type DashboardSwitcherConfig = z.infer<typeof DashboardSwitcherConfigSchema>
