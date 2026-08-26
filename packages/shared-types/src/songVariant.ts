import { z } from 'zod'
import { TimecodeMarkerSchema } from './song.js'

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
})
export type TrackMeta = z.infer<typeof TrackMetaSchema>

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
  chordProContent: z.string(),
  timecodes: z.array(TimecodeMarkerSchema).default([]),
  tracks: z.array(TrackMetaSchema).default([]),
})
export type SongVariant = z.infer<typeof SongVariantSchema>
