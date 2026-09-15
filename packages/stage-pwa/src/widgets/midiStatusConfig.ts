import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default. */
export const DEFAULT_SIZE_RATIO = 1.3

export const MidiStatusConfigSchema = z.object({
  sizeRatio: z.number().positive().optional(),
})
export type MidiStatusConfig = z.infer<typeof MidiStatusConfigSchema>
