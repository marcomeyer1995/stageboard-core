import { z } from 'zod'

/** Open tunings offered in the Stimmung picker - the chords stay as written (Marco, 2026-10-18). */
export const OPEN_TUNINGS = ['dadgad', 'open-g', 'open-d', 'open-e'] as const
export type OpenTuning = (typeof OPEN_TUNINGS)[number]

/**
 * How the instruments are tuned (Marco, 2026-10-18: one guided field instead of free text):
 * `semitones` from standard for the whole neck (-1 = a half step down, Eb), optionally with the
 * low string a further whole step down (`drop`: Drop D at 0, Drop C# at -1) or an open tuning.
 * Only `semitones` moves the chords shown (stage-pwa lib/pitch.ts); drop/open are a chip.
 */
export const TuningSchema = z.object({
  semitones: z.number().int().min(-6).max(6),
  drop: z.boolean().optional(),
  open: z.enum(OPEN_TUNINGS).optional(),
})
export type Tuning = z.infer<typeof TuningSchema>
