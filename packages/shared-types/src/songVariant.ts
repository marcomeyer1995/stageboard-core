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
  /** Playing length in ms, measured from the audio file on upload (or lazily backfilled for
   * older tracks, #28). Absent means "unknown" - the Festival Clock then falls back to an
   * estimate for that song. */
  durationMs: z.number().int().nonnegative().optional(),
})
export type TrackMeta = z.infer<typeof TrackMetaSchema>

/** "Bar `bar` starts exactly at `timeMs`" - an alignment point of the rigid click grid
 * (docs/14 §5a). Bars are counted from 1 = the bar the click starts on after the count-in. */
export const GridPointSchema = z.object({
  id: z.string().min(1),
  bar: z.number().int().positive(),
  timeMs: z.number().int().nonnegative(),
  /** The stretch from this point to the next one changes tempo evenly (ritardando/accelerando,
   * #354) instead of being constant. Absent = constant, as before. */
  gradual: z.boolean().optional(),
})
export type GridPoint = z.infer<typeof GridPointSchema>

/** A time-signature change from bar `bar` on (e.g. one 2/4 bar) - it changes how beats are
 * counted, so it is stored explicitly; tempo changes need no entry of their own. */
export const MeterChangeSchema = z.object({
  bar: z.number().int().min(2),
  timeSignature: z.string().regex(/^\d+\/\d+$/),
})
export type MeterChange = z.infer<typeof MeterChangeSchema>

/**
 * The rigid click grid (docs/14 §5a, 2026-09-27): a ruler of evenly spaced beats, aligned to the
 * track at a few bars. Between two points the tempo is constant (the bars between them split
 * evenly); before the first and after the last point the neighbouring stretch's tempo carries
 * on; with a single point the whole song runs at the variant's `bpm`. Replaces the
 * earlier beat anchors and tempo markers.
 */
export const BeatGridSchema = z.object({
  points: z.array(GridPointSchema).min(1),
  meters: z.array(MeterChangeSchema).default([]),
})
export type BeatGrid = z.infer<typeof BeatGridSchema>

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
  /** The click grid (docs/14 §5a) - see BeatGridSchema's own doc comment. Absent: bar 1 at 0:00
   * at the variant's `bpm`. (Variants from before 2026-09-27 may still carry `beatAnchors`/
   * `tempoMarkers` in the database; nothing reads them, and the next save drops them.) */
  beatGrid: BeatGridSchema.optional(),
  /** Whether a count-in plays before bar 1 (#25 follow-up) - off by default. */
  countInEnabled: z.boolean().default(false),
  /** Bars of count-in to play before bar 1 when enabled, at the spacing of the grid's first stretch. */
  countInBars: z.number().int().positive().default(1),
  /** Playing length in ms entered by hand (#28) - for songs without a backing track, or to
   * override a measured track length. The Festival Clock prefers it over `TrackMeta.durationMs`. */
  durationMs: z.number().int().positive().optional(),
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
