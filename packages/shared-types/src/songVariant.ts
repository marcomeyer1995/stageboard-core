import { z } from 'zod'
import { TimecodeMarkerSchema } from './song.js'
import { ShowCueSchema } from './showCue.js'

/**
 * `reference`: a learning aid (e.g. an extracted YouTube recording), never the source of
 * truth for a live show. `band-mix`: the band's own stereo/mono backing track. `stem`: one
 * isolated instrument, derived from another track (see `parentTrackId`).
 */
export const TrackKindSchema = z.enum(['reference', 'band-mix', 'stem'])
export type TrackKind = z.infer<typeof TrackKindSchema>

export const TrackMetaSchema = z.object({
  /** Also the PouchDB attachment key on the owning SongVariant doc, namespaced `track-${id}`. */
  id: z.string().min(1),
  kind: TrackKindSchema,
  label: z.string().min(1),
  source: z.enum(['upload', 'youtube-extract', 'stem-separation']),
  /** Which track a stem was derived from; null for anything uploaded/extracted directly. */
  parentTrackId: z.string().nullable(),
  mimeType: z.string(),
  addedAt: z.number().int().nonnegative(),
  /** Absent (not 0) means "unknown" - tracks uploaded before this field existed. Excluded
   * from catalog-size totals rather than counted as zero (see audioStorageManager.ts). */
  sizeBytes: z.number().int().nonnegative().optional(),
})
export type TrackMeta = z.infer<typeof TrackMetaSchema>

/**
 * A downbeat's exact timestamp on this variant's own timeline (#25 follow-up) - the Click
 * Generator/Visual Metronome's beat grid resets phase to `timeMs` for whatever comes after it,
 * rather than extrapolating bpm from song-start for the whole song. This is deliberately *not*
 * a tempo-map entry (no bpm here) - the song's one stored `bpm` still governs spacing
 * everywhere; an anchor only ever corrects *where* beat 0 falls, so a lead-in, a one-off
 * dropped/added bar, or small accumulated drift can all be fixed at the next anchor without
 * modeling per-segment tempo (that's #141's territory, deliberately out of scope here). Reuses
 * the same song-relative-timestamp shape as `ShowCue.timeMs`/`TimecodeMarker.timeMs`.
 */
export const BeatAnchorSchema = z.object({
  id: z.string().min(1),
  timeMs: z.number().int().nonnegative(),
})
export type BeatAnchor = z.infer<typeof BeatAnchorSchema>

/**
 * A fully self-contained, playable arrangement of a song ("Original", "Akustik", "Kurzfassung
 * Firmenfeier", ...). Deliberately a full copy of a song's playable content rather than a
 * delta/override on top of `Song` - a `bpm: number | null` ("inherit from Song") model would
 * need resolution logic duplicated everywhere bpm/content is read (PrompterWidget,
 * computeQueue, the tuner's reference pitch, ...); a variant shaped just like `Song` needs
 * none of that, and ChordPro text is cheap enough that full copies cost nothing meaningful.
 */
export const SongVariantSchema = z.object({
  id: z.string().min(1),
  songId: z.string().min(1),
  label: z.string().min(1),
  isDefault: z.boolean(),
  bpm: z.number().positive(),
  /** e.g. "4/4", "6/8" - see song.ts's field doc. Genuinely arrangement-specific (an "Akustik"
   * variant can switch feel), same reasoning as key/tuning/capo below rather than bpm's
   * would-be-fine-either-way duplication. */
  timeSignature: z.string().default('4/4'),
  /** Whether this variant wants the Click Generator running by default - see song.ts's field
   * doc. Arrangement-specific like timeSignature above: an "Akustik" variant might want a
   * click where "Original" (with a full backing track) doesn't. */
  clickTrackEnabled: z.boolean().default(false),
  chordProContent: z.string(),
  timecodes: z.array(TimecodeMarkerSchema).default([]),
  tracks: z.array(TrackMetaSchema).default([]),
  /** Show-hardware commands anchored to this variant's own timeline (#99) - variant-specific
   * like `timecodes`/`tracks` above, not on `Song`: an "Akustik" variant plausibly needs none
   * at all, while "Original" fires a Kemper rig change at the second chorus. */
  cues: z.array(ShowCueSchema).default([]),
  /** Manual and/or auto-detected downbeat sync points (#25 follow-up) - see BeatAnchorSchema's
   * own doc comment. Empty by default, reproducing today's beat-grid behavior exactly (beat 0
   * pinned to elapsedMs 0) until someone adds an anchor. */
  beatAnchors: z.array(BeatAnchorSchema).default([]),
  /** Musical key, e.g. "F#m" - genuinely arrangement-specific (a capo/tuning change can
   * shift it), so it lives here rather than on Song. Optional/absent, not a forced default:
   * most sources (including Ultimate Guitar's own data) simply omit it when unknown, and a
   * blank string would be indistinguishable from "known to have no key". */
  key: z.string().optional(),
  /** e.g. "E A D G B E" or "Drop D". */
  tuning: z.string().optional(),
  /** Fret number. Absent (not 0) means "no capo", matching how Ultimate Guitar itself only
   * includes this field at all when a capo is actually used. */
  capo: z.number().int().nonnegative().optional(),
})
export type SongVariant = z.infer<typeof SongVariantSchema>
