import { z } from 'zod'

export const DashboardSwitcherConfigSchema = z.object({
  orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
  /** null = every dashboard, in `order`. A list pins the widget to specific ones. */
  dashboardIds: z.array(z.string()).nullable().default(null),
})
export type DashboardSwitcherConfig = z.infer<typeof DashboardSwitcherConfigSchema>
