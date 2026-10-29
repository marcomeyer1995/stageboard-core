import i18n from '../i18n'
import type { StemRole, TrackMeta } from 'shared-types'
import type { DialogField } from '../store/useDialogStore'

/**
 * Stems (#9, docs/22): `kind: 'stem'` tracks that together make the song - split from another
 * track of the variant by the Stage-Server's stem-separation plugin (`parentTrackId`), or uploaded
 * as files from the band leader (`parentTrackId: null`). They are not alternatives to play as the
 * backing track and aren't downloaded to every device - only listed, heard and renamed.
 */
export function isStem(track: Pick<TrackMeta, 'kind'>): boolean {
  return track.kind === 'stem'
}

/** The tracks that can be the song's backing track - everything but stems. */
export function playableTracks(tracks: readonly TrackMeta[]): TrackMeta[] {
  return tracks.filter((t) => !isStem(t))
}

export function stemsOf(tracks: readonly TrackMeta[], parentTrackId: string): TrackMeta[] {
  return tracks.filter((t) => isStem(t) && t.parentTrackId === parentTrackId)
}

/**
 * The uploaded stem set (docs/22 §2): every stem not split from a track of this variant. A set
 * needs no id of its own - a separated set is its track's stems, and a variant has at most one
 * uploaded set (a variant is one arrangement; a new delivery replaces stems one by one).
 */
export function uploadedStems(tracks: readonly TrackMeta[]): TrackMeta[] {
  const ids = new Set(tracks.map((t) => t.id))
  return tracks.filter((t) => isStem(t) && (t.parentTrackId === null || !ids.has(t.parentTrackId)))
}

export const STEM_ROLE_LABELS = Object.fromEntries(
  (['drums', 'bass', 'guitar', 'keys', 'vocals', 'choir', 'click', 'other'] as const).map((role) => [role, role]),
) as Record<StemRole, string>
for (const role of Object.keys(STEM_ROLE_LABELS) as StemRole[]) {
  Object.defineProperty(STEM_ROLE_LABELS, role, { get: () => i18n.t(`editor:stem.role.${role}`), enumerable: true })
}

/** Checked in this order - "Bassdrum" is drums, "Bass guitar" bass, "Backing vocals" choir. */
const ROLE_WORDS: [StemRole, RegExp][] = [
  ['click', /click|klick|metronom/],
  ['drums', /drum|schlagzeug|kick|snare|hi-?hat|\btoms?\b|overhead|perc|cajon/],
  ['choir', /choir|chor|backing ?voc|\bbvs?\b|backings?\b/],
  ['vocals', /voc|vox|gesang|voice|stimme|\bsing/],
  ['bass', /bass/],
  ['guitar', /guit|gtr|gitarre/],
  ['keys', /key|piano|organ|orgel|hammond|synth|rhodes|klavier|wurli|\bpad/],
]

/** A stem's role guessed from its file name - a suggestion the musician can change. */
export function guessStemRole(fileName: string): StemRole | undefined {
  const name = fileName.toLowerCase().replace(/[_.]+/g, ' ')
  return ROLE_WORDS.find(([, words]) => words.test(name))?.[0]
}

/** "03_Hammond Orgel.wav" → "Hammond Orgel". */
export function labelFromFileName(fileName: string): string {
  const label = fileName
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/^\s*\d{1,3}\s*[-.)]?\s+/, '')
    .trim()
  return label || fileName
}

/** Stems of one set must be equally long from 0:00 (docs/22 §6) - more than this apart means one
 * was exported differently and would play out of place. */
const LENGTH_TOLERANCE_MS = 1000

/** True when the known lengths of a set's stems differ by more than the tolerance. */
export function stemLengthsDiffer(stems: readonly TrackMeta[]): boolean {
  const lengths = stems.map((s) => s.durationMs).filter((d): d is number => d !== undefined)
  return lengths.length > 1 && Math.max(...lengths) - Math.min(...lengths) > LENGTH_TOLERANCE_MS
}

/** A playable group of stems: those split from one track, or the uploaded ones (key `upload`). */
export interface StemSet {
  key: string
  label: string
  stems: TrackMeta[]
}

export const UPLOADED_SET = 'upload'

/** Every stem set of a variant - uploaded first (the band leader's, made for playing), then one
 * per separated track. */
export function stemSetsOf(tracks: readonly TrackMeta[]): StemSet[] {
  const sets: StemSet[] = []
  const uploaded = uploadedStems(tracks)
  if (uploaded.length) sets.push({ key: UPLOADED_SET, label: 'Hochgeladen', stems: uploaded })
  for (const track of playableTracks(tracks)) {
    const stems = stemsOf(tracks, track.id)
    if (stems.length) sets.push({ key: track.id, label: `Aus ${track.label}`, stems })
  }
  return sets
}

/** The set that plays: the chosen one, else the uploaded set, else the playing track's stems,
 * else the first. */
export function pickStemSet(sets: readonly StemSet[], chosen: string | null, playingTrackId: string | null): StemSet | null {
  return sets.find((s) => s.key === chosen) ?? sets.find((s) => s.key === UPLOADED_SET) ?? sets.find((s) => s.key === playingTrackId) ?? sets[0] ?? null
}

/** The stems shown under the Timeline's waveform for `trackId`: those split from it, else the
 * first set (uploaded first). */
export function stemsForTrack(tracks: readonly TrackMeta[], trackId: string | null): TrackMeta[] {
  const sets = stemSetsOf(tracks)
  return (sets.find((set) => set.key === trackId) ?? sets[0])?.stems ?? []
}

/** With stems, "Track analysieren" asks which audio its hits come from (Marco 2026-10-16: the only
 * action that needs the choice, so no setting to keep) - in the Timeline and on the Tempo page
 * alike. Without stems: the mix, no question. Null: the mix, a stem id: that stem, undefined:
 * cancelled. */
export async function askAnalysisSource(
  promptFields: (title: string, fields: DialogField[], submitLabel?: string) => Promise<Record<string, string> | null>,
  stems: readonly TrackMeta[],
  current: string | null = null,
): Promise<string | null | undefined> {
  if (stems.length === 0) return null
  const result = await promptFields(
    i18n.t('editor:src.title'),
    [
      {
        key: 'source',
        label: i18n.t('editor:src.field'),
        type: 'radio',
        defaultValue: current ?? '',
        options: [{ value: '', label: i18n.t('editor:src.mix') }, ...stems.map((s) => ({ value: s.id, label: s.label }))],
      },
    ],
    i18n.t('editor:src.go'),
  )
  if (!result) return undefined
  return result.source || null
}
