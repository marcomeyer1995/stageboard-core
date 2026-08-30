import { type Song, type SongVariant, type TrackMeta } from 'shared-types'
import { cacheKey } from './audioCache'
import { deleteTrackFile, fetchTrack, uploadTrack } from './audioClient'
import { getAudioStorageBackend } from './audioStorageBackend'
import { getBackingTrack } from './db'
import { randomId } from './id'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type SongVariantDoc = Doc<SongVariant>

const variants = createWorkspaceCollection<SongVariant>('song-variants')

export const getVariantsDb = variants.getDb
export const switchVariantsWorkspace = variants.switchWorkspace
export const getAllVariants = variants.getAll
export const putVariant = variants.put
export const variantsChanges = variants.changes

/**
 * Creates the one isDefault variant for a song that predates variants, copying its content
 * and (if present) its legacy single 'backing-track' attachment across as a `band-mix` track.
 * Idempotent and safe to call redundantly from any tablet - this is a local-first mesh, there
 * is no single moment "the migration runs": every tablet calls this lazily on first touch.
 */
export async function ensureDefaultVariant(song: Song): Promise<SongVariant> {
  const existing = (await getAllVariants()).find((v) => v.songId === song.id && v.isDefault)
  if (existing) return existing

  const variant: SongVariant = {
    id: randomId(),
    songId: song.id,
    label: 'Original',
    isDefault: true,
    bpm: song.bpm,
    chordProContent: song.chordProContent,
    timecodes: song.timecodes,
    tracks: [],
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

export async function removeTrack(variantId: string, trackId: string): Promise<void> {
  await deleteTrackFile(variantId, trackId)
  await getAudioStorageBackend().remove(cacheKey(variantId, trackId))

  const db = getVariantsDb()
  const current = await db.get(variants.docId(variantId))
  const tracks = current.tracks.filter((t) => t.id !== trackId)
  await putVariant({ ...current, tracks })
}
