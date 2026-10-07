import { z } from 'zod'

export const TimecodeMarkerSchema = z.object({
  timeMs: z.number().int().nonnegative(),
  label: z.string().min(1),
})
export type TimecodeMarker = z.infer<typeof TimecodeMarkerSchema>

export const SongSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  bpm: z.number().positive(),
  /** e.g. "4/4", "6/8" - the beat grid a click/metronome (#25) counts against, and where the
   * accented downbeat falls. Defaults to the overwhelmingly common case so existing docs
   * validate unchanged. Arrangement-specific like bpm/key/tuning, not artist - lives here too
   * only as the same read-compatibility mirror of the default variant (see songVariant.ts). */
  timeSignature: z.string().default('4/4'),
  /** Whether this song wants the Click Generator (#25) running by default when played - a
   * band's authored preference (e.g. a song with no backing track almost always wants one),
   * not a live decision. A show can still force it on/off for one performance regardless via
   * ShowState.clickTrackOverride, without touching this stored default. Same
   * read-compatibility-mirror placement as timeSignature above. */
  clickTrackEnabled: z.boolean().default(false),
  chordProContent: z.string(),
  timecodes: z.array(TimecodeMarkerSchema).default([]),
  /** The band/artist who performed it - unlike bpm/key/tuning/capo, this doesn't change
   * between arrangements of the same song, so it lives here rather than on SongVariant. */
  artist: z.string().optional(),
})
export type Song = z.infer<typeof SongSchema>

/**
 * One practice take in Solo Üben (Marco, 2026-10-07: "when did I last train this song, and how
 * often this month"): the song ran at least MIN_SONG_DURATION_MS (unpaused) before it was stopped,
 * reset or left. Per person - synced through the band database so every device of that person
 * counts together; the Bibliothek sorts by it.
 */
export const PracticeLogEntrySchema = z.object({
  id: z.string().min(1),
  profileId: z.string().min(1),
  songId: z.string().min(1),
  /** When the take ended (ms). */
  at: z.number().int().nonnegative(),
  activeMs: z.number().int().nonnegative(),
})
export type PracticeLogEntry = z.infer<typeof PracticeLogEntrySchema>
