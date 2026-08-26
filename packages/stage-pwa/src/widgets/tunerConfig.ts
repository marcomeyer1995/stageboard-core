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

// Marco's preferred setting from testing (old "high", 0.002) is now the "medium"
// reference point, with low/high rebuilt around it at roughly the same ~4x-per-step
// spread the first version used end to end.
export const SENSITIVITY_MIN_RMS: Record<TunerConfig['sensitivity'], number> = {
  low: 0.008,
  medium: 0.002,
  high: 0.0005,
}

export interface ResponsivenessSettings {
  size: number
  minReadings: number
  maxMisses: number
}

// The tick loop runs at up to ~60fps (one detectPitch call per animation frame), so
// maxMisses in "frames" translates roughly to maxMisses/60 seconds of grace before the
// note disappears. Marco's preferred setting from testing (old "fast": size 5,
// minReadings 2, maxMisses 6 - ~0.1s grace) is now the "balanced" reference point, with
// stable/fast rebuilt around it at roughly the same ~3x-per-step spread the first
// version used end to end - fast keeps just enough window (size 3) to still reject a
// single-frame octave-error outlier, since going all the way to no smoothing at all
// would bring back the original "jumps around wildly" bug this was built to fix.
export const RESPONSIVENESS_SETTINGS: Record<TunerConfig['responsiveness'], ResponsivenessSettings> = {
  // ~0.3s grace before a faded note disappears - noticeably steadier than balanced
  // without swinging back to the old extreme (1.5s).
  stable: { size: 15, minReadings: 6, maxMisses: 18 },
  balanced: { size: 5, minReadings: 2, maxMisses: 6 },
  // ~0.05s grace - about as snappy as it can get while still median-filtering out a
  // single bad reading.
  fast: { size: 3, minReadings: 1, maxMisses: 3 },
}
