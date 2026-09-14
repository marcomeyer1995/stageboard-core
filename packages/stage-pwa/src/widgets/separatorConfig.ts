import { z } from 'zod'
import { WIDGET_COLORS } from './widgetColors'

export const SeparatorConfigSchema = z.object({
  orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
  color: z.enum(WIDGET_COLORS).default('neutral'),
})
export type SeparatorConfig = z.infer<typeof SeparatorConfigSchema>
