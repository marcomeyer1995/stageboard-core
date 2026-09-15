import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 1.5

export const DeviceStatusConfigSchema = z.object({
  logicalDeviceId: z.string().optional(),
  sizeRatio: z.number().positive().optional(),
})
export type DeviceStatusConfig = z.infer<typeof DeviceStatusConfigSchema>
