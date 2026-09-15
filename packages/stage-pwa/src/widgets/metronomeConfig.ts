import { z } from 'zod'

/** Roughly matches this widget's previous typical auto-fit size at the device default -
 * only the `number` style's big beat count uses this (`beat-dots` is sized in cqmin,
 * unaffected - it's a row of same-size dots, not text). */
export const DEFAULT_SIZE_RATIO = 3.5

export const MetronomeConfigSchema = z.object({
  /** `number`: a big beat-in-bar count, easiest to read at a glance from a distance.
   * `beat-dots`: a row of dots across the bar, the current beat lit - reads the bar's
   * shape at once, which matters more once #25's follow-up (variable-length bars, 6/8
   * feel) exists. Left to the musician per docs/07's "idiotensicher by default, complex
   * behind a choice" principle - there's no objectively correct one. */
  style: z.enum(['number', 'beat-dots']).default('number'),
  sizeRatio: z.number().positive().optional(),
})
export type MetronomeConfig = z.infer<typeof MetronomeConfigSchema>
