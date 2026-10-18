import { type Song, type SongVariant, type StemRole, type TrackMeta } from 'shared-types'
import { cacheKey } from './audioCache'
import { deleteTrackFile, fetchTrack, uploadTrack } from './audioClient'
import { getAudioStorageBackend } from './audioStorageBackend'
import { getBackingTrack, putSong, removeBackingTrack, removeSong } from './db'
import { randomId } from './id'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type SongVariantDoc = Doc<SongVariant>

const variants = createWorkspaceCollection<SongVariant>('song-variants')

export const getVariantsDb = variants.getDb
export const switchVariantsWorkspace = variants.switchWorkspace
export const getAllVariants = variants.getAll
export const putVariant = variants.put
export const removeVariant = variants.remove
export const variantsChanges = variants.changes

/** A raw, unvalidated PouchDB read (unlike useSongVariantsStore's own toVariant, which already
 * normalizes its reactive `variants` array): a variant written before `cues` (#99) or
 * `timeSignature` (#25) existed simply lacks the key. Found live: crashed CueListEditor on any
 * song predating the `cues` field. */
function withDefaults(variant: SongVariant): SongVariant {
  return {
    ...variant,
    timeSignature: variant.timeSignature ?? '4/4',
    clickTrackEnabled: variant.clickTrackEnabled ?? false,
    cues: variant.cues ?? [],
    countInEnabled: variant.countInEnabled ?? false,
    countInBars: variant.countInBars ?? 1,
  }
}

async function variantsOfSong(songId: string): Promise<SongVariant[]> {
  return (await getAllVariants()).filter((v) => v.songId === songId).map(withDefaults)
}

/**
 * Which variant the editor/preview opens: the asked-for one, else the default. A song whose
 * default was deleted has none (Marco, 2026-10-18: no variant becomes default by itself) - then
 * the first by name, so the editor can still open it and set a default again; that's editing,
 * not playing, so no stage fallback. A song without any variant gets its default created
 * (ensureDefaultVariant).
 */
export async function variantToOpen(song: Song, preferredVariantId: string | null = null): Promise<SongVariant> {
  const ofSong = await variantsOfSong(song.id)
  const preferred = preferredVariantId ? ofSong.find((v) => v.id === preferredVariantId) : undefined
  if (preferred) return preferred
  const byDefault = ofSong.find((v) => v.isDefault)
  if (byDefault) return byDefault
  if (ofSong.length > 0) return [...ofSong].sort((a, b) => a.label.localeCompare(b.label))[0]!
  return ensureDefaultVariant(song)
}

/**
 * Creates the one isDefault variant for a song that predates variants, copying its content
 * and (if present) its legacy single 'backing-track' attachment across as a `band-mix` track.
 * Idempotent and safe to call redundantly from any tablet - this is a local-first mesh, there
 * is no single moment "the migration runs": every tablet calls this lazily on first touch.
 * Only for a song with no variants at all - one whose default was deleted keeps having none
 * (variantToOpen), it must not come back as a fresh "Original" from the Song's mirror fields.
 */
export async function ensureDefaultVariant(song: Song): Promise<SongVariant> {
  const existing = (await variantsOfSong(song.id)).find((v) => v.isDefault)
  if (existing) return existing

  const variant: SongVariant = {
    id: randomId(),
    songId: song.id,
    label: 'Original',
    isDefault: true,
    bpm: song.bpm,
    timeSignature: song.timeSignature ?? '4/4',
    clickTrackEnabled: song.clickTrackEnabled ?? false,
    chordProContent: song.chordProContent,
    timecodes: song.timecodes,
    tracks: [],
    cues: [],
    countInEnabled: false,
    countInBars: 1,
  }
  await putVariant(variant)

  const legacyTrack = await getBackingTrack(song.id)
  if (!legacyTrack) return variant

  const trackMeta: TrackMeta = {
    id: 'backing-track',
    kind: 'band-mix',
    label: 'Backing-Track',
    source: 'upload',
    parentTrackId: null,
    mimeType: legacyTrack.type,
    addedAt: Date.now(),
    sizeBytes: legacyTrack.size,
  }
  await putTrack(variant.id, trackMeta, legacyTrack)
  return { ...variant, tracks: [trackMeta] }
}

/**
 * Track audio lives on the Stage-Server's disk now, not as a PouchDB attachment (see #30) -
 * every tablet used to receive every byte of every band's audio catalog through this
 * collection's live sync stream whether it wanted it or not. Uploads to the server, caches
 * the bytes locally through the storage backend (audioStorageManager.ts owns whether that
 * cache entry survives - see #49), then updates just the track metadata as a plain JSON doc.
 */
export async function putTrack(variantId: string, meta: TrackMeta, file: Blob): Promise<void> {
  const result = await uploadTrack(variantId, meta.id, file)
  if (result.status === 'error') throw new Error(result.message)
  const metaWithSize: TrackMeta = { ...meta, sizeBytes: file.size }
  await getAudioStorageBackend().set(cacheKey(variantId, metaWithSize.id), file)

  const db = getVariantsDb()
  const current = await db.get(variants.docId(variantId))
  const tracks = [...current.tracks.filter((t) => t.id !== metaWithSize.id), metaWithSize]
  await putVariant({ ...current, tracks })
}

/** Local cache first, then the Stage-Server. `null` covers both "no such track" and
 * "not cached and currently unreachable" - the caller can't tell those apart, and for
 * playback purposes it doesn't need to. A track fetched here gets cached unconditionally,
 * even in "None" sync mode - the reconciler (audioStorageManager.ts) evicts it again shortly
 * after if it doesn't belong, rather than this call site needing to know the current mode. */
export async function getTrack(variantId: string, trackId: string): Promise<Blob | null> {
  const backend = getAudioStorageBackend()
  const key = cacheKey(variantId, trackId)
  const cached = await backend.get(key)
  if (cached) return cached

  const fetched = await fetchTrack(variantId, trackId)
  if (fetched) await backend.set(key, fetched)
  return fetched
}

/** Removes a track - and the stems split from it (#9), which mean nothing without it. */
export async function removeTrack(variantId: string, trackId: string): Promise<void> {
  const db = getVariantsDb()
  const before = await db.get(variants.docId(variantId))
  const gone = [trackId, ...before.tracks.filter((t) => t.kind === 'stem' && t.parentTrackId === trackId).map((t) => t.id)]
  for (const id of gone) {
    await deleteTrackFile(variantId, id)
    await getAudioStorageBackend().remove(cacheKey(variantId, id))
  }

  const current = await db.get(variants.docId(variantId))
  const tracks = current.tracks.filter((t) => !gone.includes(t.id))
  await putVariant({ ...current, tracks })
}

/**
 * Deletes one variant with its tracks (server audio + local cache, like `removeTrack`). Setlist
 * entries that picked it stay as they are and show "Variante gelöscht" (Marco, 2026-10-18: never
 * the default in its place - see computeQueue's VariantIssue). Deleting the default leaves the
 * song without one until a variant is set as default again. The last variant can't go - without
 * any, the song would play its old default's mirrored fields again; delete the song instead.
 */
export async function deleteVariant(variantId: string): Promise<void> {
  const variant = (await getAllVariants()).find((v) => v.id === variantId)
  if (!variant) return
  if ((await variantsOfSong(variant.songId)).length <= 1) throw new Error('Die letzte Variante kann nicht gelöscht werden.')
  for (const track of variant.tracks) {
    await deleteTrackFile(variantId, track.id)
    await getAudioStorageBackend().remove(cacheKey(variantId, track.id))
  }
  await removeVariant(variantId)
}

/** Makes `variantId` the song's one default variant and mirrors its content onto the Song doc
 * (Song.bpm/chordProContent/... - the read-compatibility mirror of the default, see song.ts). */
export async function setDefaultVariant(song: Song, variantId: string): Promise<void> {
  const ofSong = await variantsOfSong(song.id)
  const next = ofSong.find((v) => v.id === variantId)
  if (!next) return
  for (const variant of ofSong) {
    const isDefault = variant.id === variantId
    if (variant.isDefault !== isDefault) await putVariant({ ...variant, isDefault })
  }
  await putSong({
    ...song,
    bpm: next.bpm,
    timeSignature: next.timeSignature,
    clickTrackEnabled: next.clickTrackEnabled,
    chordProContent: next.chordProContent,
    timecodes: next.timecodes,
  })
}

/** A stem's new name and role (docs/22 §2) - e.g. "Gitarre links" becomes "Gitarre Marco";
 * `role: undefined` clears the role. */
export async function updateStem(variantId: string, trackId: string, label: string, role: StemRole | undefined): Promise<void> {
  const name = label.trim()
  if (!name) return
  const db = getVariantsDb()
  const current = await db.get(variants.docId(variantId))
  await putVariant({
    ...current,
    tracks: current.tracks.map((t) => {
      if (t.id !== trackId) return t
      const next: TrackMeta = { ...t, label: name }
      if (role) next.role = role
      else delete next.role
      return next
    }),
  })
}

/**
 * Copies a song's own doc and every one of its variants (#178's desktop context menu) - the
 * chart, tempo, cues and click grid all come along, since those are what make
 * a duplicate a genuinely useful starting point (e.g. an "Akustik" arrangement branched off the
 * original). Tracks deliberately don't: audio lives on the Stage-Server's own disk (#30), and
 * copying it would mean re-uploading every byte through this tablet rather than a cheap
 * metadata copy - the duplicate starts with no audio, same as any other freshly created song.
 */
export async function duplicateSongAndVariants(song: Song, newTitle: string): Promise<Song> {
  const copy: Song = { ...song, id: randomId(), title: newTitle }
  await putSong(copy)

  const sourceVariants = (await getAllVariants()).filter((variant) => variant.songId === song.id)
  for (const variant of sourceVariants) {
    await putVariant({ ...variant, id: randomId(), songId: copy.id, tracks: [] })
  }

  return copy
}

/**
 * Deletes a song along with everything only it owns (#105) - its variants and their tracks
 * (server-side audio + local cache, same cleanup `removeTrack` already does per-track), plus
 * any pre-migration legacy attachment `ensureDefaultVariant` hasn't converted yet. Setlist
 * entries referencing this song are deliberately left alone: `computeQueue` already drops a
 * setlist entry whose song no longer exists in the catalog (own test coverage), so they degrade
 * gracefully rather than needing an active prune here.
 */
export async function removeSongAndVariants(songId: string): Promise<void> {
  await removeBackingTrack(songId)

  const songVariants = (await getAllVariants()).filter((variant) => variant.songId === songId)
  for (const variant of songVariants) {
    for (const track of variant.tracks) {
      await removeTrack(variant.id, track.id)
    }
    await removeVariant(variant.id)
  }

  await removeSong(songId)
}
