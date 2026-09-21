import { z } from 'zod'

export const DEFAULT_SIZE_RATIO = 1.6

export const ChordReferenceConfigSchema = z.object({
  /** F# vs Gb for the same pitch - the same choice the tuner offers. */
  noteNaming: z.enum(['sharp', 'flat']).default('sharp'),
  showGuitar: z.boolean().default(true),
  showPiano: z.boolean().default(true),
  sizeRatio: z.number().positive().optional(),
})
export type ChordReferenceConfig = z.infer<typeof ChordReferenceConfigSchema>
