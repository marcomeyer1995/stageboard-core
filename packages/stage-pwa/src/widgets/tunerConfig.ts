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

export const SENSITIVITY_MIN_RMS: Record<TunerConfig['sensitivity'], number> = {
  low: 0.02,
  medium: 0.01,
  high: 0.003,
}

export interface ResponsivenessSettings {
  size: number
  minReadings: number
  maxMisses: number
}

export const RESPONSIVENESS_SETTINGS: Record<TunerConfig['responsiveness'], ResponsivenessSettings> = {
  // Heavier smoothing and a long grace period before the note disappears - best for a
  // sustained, decaying note (an open chord left ringing) rather than fast passages.
  stable: { size: 14, minReadings: 5, maxMisses: 16 },
  balanced: { size: 8, minReadings: 3, maxMisses: 8 },
  // Reacts almost immediately, at the cost of looking more jumpy and losing the display
  // sooner once a note actually stops.
  fast: { size: 4, minReadings: 2, maxMisses: 4 },
}
