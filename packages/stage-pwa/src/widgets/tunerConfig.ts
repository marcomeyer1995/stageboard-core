import { z } from 'zod'

export const TunerConfigSchema = z.object({
  /** How quiet a note can still be and get picked up - lower catches more of a note's
   * decay, at the cost of also catching more background noise. Maps to detectPitch's
   * minRms gate. */
  sensitivity: z.enum(['low', 'medium', 'high']).default('medium'),
  /** How quickly the display reacts to a new note or to one fading out, versus how
   * smoothed/stable the reading looks. Maps to PitchHistory's window size. */
  responsiveness: z.enum(['stable', 'balanced', 'fast']).default('balanced'),
})
export type TunerConfig = z.infer<typeof TunerConfigSchema>

// Roughly a 15x range end to end - the first version of these (0.02/0.01/0.003) was too
// narrow a spread to actually notice switching between levels.
export const SENSITIVITY_MIN_RMS: Record<TunerConfig['sensitivity'], number> = {
  low: 0.03,
  medium: 0.01,
  high: 0.002,
}

export interface ResponsivenessSettings {
  size: number
  minReadings: number
  maxMisses: number
}

// The tick loop runs at up to ~60fps (one detectPitch call per animation frame), so
// maxMisses in "frames" translates roughly to maxMisses/60 seconds of grace before the
// note disappears. The first version of these (4/8/16 misses - 67/133/267ms) all landed
// in the same barely-perceptible fraction-of-a-second range; these are spread across
// roughly a tenth of a second up to 1.5 seconds instead, which should actually be felt.
export const RESPONSIVENESS_SETTINGS: Record<TunerConfig['responsiveness'], ResponsivenessSettings> = {
  // ~1.5s grace before a faded note disappears, ~0.65s to fully settle onto a newly
  // played one - best for a sustained, decaying note (an open chord left ringing)
  // rather than fast passages.
  stable: { size: 40, minReadings: 15, maxMisses: 90 },
  balanced: { size: 15, minReadings: 6, maxMisses: 30 },
  // Reacts almost immediately (~0.1s to settle on a new note), at the cost of looking
  // more jumpy and losing the display almost as soon as a note actually stops.
  fast: { size: 5, minReadings: 2, maxMisses: 6 },
}
