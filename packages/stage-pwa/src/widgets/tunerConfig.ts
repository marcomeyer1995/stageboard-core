import { z } from 'zod'

export const TunerConfigSchema = z.object({
  /** How quiet a note can still be and get picked up - lower catches more of a note's
   * decay, at the cost of also catching more background noise. Passed directly to
   * detectPitch's minRms gate. Default (0.007) matches what tested best manually. */
  minRms: z.number().min(0.0005).max(0.1).default(0.007),
  /** How many recent readings to smooth over - higher means a steadier display that's
   * slower to react to a new note or to one fading out; lower reacts almost instantly
   * but looks more jumpy. PitchHistory's size/minReadings/maxMisses are all derived from
   * this one number (responsivenessFromWindow), not exposed as separate controls.
   * Default (100) matches what tested best manually. */
  smoothingWindow: z.number().int().min(50).max(150).default(100),
  /** F# vs Gb for the same pitch. */
  noteNaming: z.enum(['sharp', 'flat']).default('sharp'),
  /** A4's frequency in Hz - 440 is standard, but some bands tune to 442/443 (orchestral
   * sharp) or 415 (baroque). */
  referenceFrequency: z.number().min(400).max(480).default(440),
})
export type TunerConfig = z.infer<typeof TunerConfigSchema>

// Centered on the 0.007 default: floor and ceiling are equidistant from it in log space
// (sqrt(floor * ceiling) ~= 0.007), so the slider's middle is where testing found the
// best setting, with headroom to go noticeably less or more sensitive either way.
const MIN_RMS_FLOOR = 0.0005
const MIN_RMS_CEILING = 0.1

/**
 * Maps a [0,100] slider position to minRms on a log scale, and *inverted*: slider 0 (the
 * "Unempfindlich" end) is the ceiling (the least sensitive, highest threshold), slider
 * 100 ("Empfindlich") is the floor (the most sensitive, lowest threshold) - minRms itself
 * runs the opposite direction from what "sensitivity" means, so mapping the slider
 * directly onto it without inverting made higher sensitivity readings sit under the
 * "less sensitive" end of the slider. Log-scaled for the same reason as before: linear
 * would squeeze the small, musically-relevant end of the range into a sliver of travel.
 */
export function sliderToMinRms(slider: number): number {
  const logFloor = Math.log10(MIN_RMS_FLOOR)
  const logCeiling = Math.log10(MIN_RMS_CEILING)
  const clampedSlider = Math.min(Math.max(slider, 0), 100)
  return Math.pow(10, logCeiling - (clampedSlider / 100) * (logCeiling - logFloor))
}

export function minRmsToSlider(minRms: number): number {
  const logFloor = Math.log10(MIN_RMS_FLOOR)
  const logCeiling = Math.log10(MIN_RMS_CEILING)
  const clamped = Math.min(Math.max(minRms, MIN_RMS_FLOOR), MIN_RMS_CEILING)
  return ((logCeiling - Math.log10(clamped)) / (logCeiling - logFloor)) * 100
}

export interface ResponsivenessSettings {
  size: number
  minReadings: number
  maxMisses: number
}

/**
 * Derives PitchHistory's three parameters from one slider value, keeping the same
 * proportions the earlier fixed low/medium/high levels used (minReadings ~40% of the
 * window, maxMisses ~120%) - a continuous version of the same behavior, not a different
 * one.
 */
export function responsivenessFromWindow(window: number): ResponsivenessSettings {
  return {
    size: window,
    minReadings: Math.max(1, Math.round(window * 0.4)),
    maxMisses: Math.max(1, Math.round(window * 1.2)),
  }
}
