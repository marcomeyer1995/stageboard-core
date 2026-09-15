import { z } from 'zod'
import { WIDGET_COLORS } from './widgetColors'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 1.8

export const CustomTriggerConfigSchema = z.object({
  label: z.string().min(1).default('Trigger'),
  color: z.enum(WIDGET_COLORS).default('accent'),
  /** Latching (toggle) fires once per press with an alternating `on` payload; momentary
   * (press-and-hold) fires separate down/up payloads. */
  behavior: z.enum(['latching', 'momentary']).default('momentary'),
  targetLogicalDeviceId: z.string().optional(),
  commandType: z.string().min(1).default('trigger'),
  /** Free-form JSON, merged into the fired ShowControlEvent's payload - parsed at fire time,
   * never at config-save time, so a momentarily invalid draft never blocks typing. */
  commandPayloadJson: z.string().default('{}'),
  sizeRatio: z.number().positive().optional(),
})
export type CustomTriggerConfig = z.infer<typeof CustomTriggerConfigSchema>
