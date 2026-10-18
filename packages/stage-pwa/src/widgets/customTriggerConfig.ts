import { z } from 'zod'
import type { Behavior } from '../lib/actions'
import { WIDGET_COLORS } from './widgetColors'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 1.8

export const CustomTriggerConfigSchema = z.object({
  /** Empty with a switch: the switch's name. */
  label: z.string().default('Trigger'),
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
  /** What the button does (docs/23 §7): any action, tastend/rastend/zeitgesteuert. Absent on a
   * button set up before - then the device fields above say it (triggerBehaviorOf). */
  action: z.custom<Behavior>((value) => typeof value === 'object' && value !== null && 'kind' in value).optional(),
})
export type CustomTriggerConfig = z.infer<typeof CustomTriggerConfigSchema>

function parsePayload(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Whether a button of the earlier form has a payload that can't be read - it then fires without it. */
export function legacyPayloadUnreadable(config: CustomTriggerConfig): boolean {
  if (config.action) return false
  try {
    JSON.parse(config.commandPayloadJson)
    return false
  } catch {
    return true
  }
}

/**
 * What a button does - its action, or for a button set up before the action picker (docs/23 §8)
 * the same device command it always sent: "Halten" as active true/false on press/release,
 * "Umschalten" as on true/false. Null: nothing chosen yet.
 */
export function triggerBehaviorOf(config: CustomTriggerConfig): Behavior | null {
  if (config.action) return config.action
  if (!config.targetLogicalDeviceId) return null
  const base = parsePayload(config.commandPayloadJson)
  const command = (payload: Record<string, unknown>) => ({ kind: 'device' as const, targetLogicalDeviceId: config.targetLogicalDeviceId!, type: config.commandType, payload: { ...base, ...payload } })
  return config.behavior === 'latching'
    ? { kind: 'latching', on: command({ on: true }), off: command({ on: false }) }
    : { kind: 'momentary', press: command({ active: true }), release: { kind: 'on-release', action: command({ active: false }) } }
}
