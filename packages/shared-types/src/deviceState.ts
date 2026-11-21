import { z } from 'zod'
import type { StateField } from './addonContract.js'

/**
 * Device state published by add-ons (docs/36 §5a, #964). A device add-on declares the **fields** its device offers (`devices[].state` in its manifest);
 * its work script publishes values for them; StageBoard keeps the latest value per field and shares it with every device of the band, where widgets
 * bind to it (`{bind: "state:<device>.<key>"}`). The core never interprets a value - it only checks it against what the add-on declared, so one add-on
 * cannot publish nonsense into every screen of the band.
 */
export const DeviceStateEventSchema = z.object({
  /** The band's logical device the value is about (`DeviceTransportConfig.logicalDeviceId`). */
  device: z.string().min(1).max(100),
  /** The declared state field. */
  key: z.string().min(1).max(100),
  value: z.union([z.string().max(500), z.number(), z.boolean()]),
  /** When the add-on published it (server time). */
  at: z.number().int().nonnegative(),
})
export type DeviceStateEvent = z.infer<typeof DeviceStateEventSchema>

export type StateCheck = { ok: true } | { ok: false; reason: string }

/** Whether `value` is a legal value of the declared `field` - its type, its allowed values, its range. */
export function checkStateValue(field: StateField, value: unknown): StateCheck {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true } : { ok: false, reason: 'expected a boolean' }
    case 'string':
      return typeof value === 'string' && value.length <= 500 ? { ok: true } : { ok: false, reason: 'expected a string of at most 500 characters' }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'expected a finite number' }
      if (field.min !== undefined && value < field.min) return { ok: false, reason: `below the minimum ${field.min}` }
      if (field.max !== undefined && value > field.max) return { ok: false, reason: `above the maximum ${field.max}` }
      return { ok: true }
    case 'enum':
      return (field.values ?? []).includes(value as string | number) ? { ok: true } : { ok: false, reason: `not one of ${(field.values ?? []).join(', ')}` }
  }
}
