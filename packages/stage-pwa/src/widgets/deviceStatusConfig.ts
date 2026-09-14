import { z } from 'zod'

export const DeviceStatusConfigSchema = z.object({
  logicalDeviceId: z.string().optional(),
})
export type DeviceStatusConfig = z.infer<typeof DeviceStatusConfigSchema>
