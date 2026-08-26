import { type Song, type SongVariant, type TrackMeta } from 'shared-types'
import { getBackingTrack } from './db'
import { randomId } from './id'
import { createWorkspaceCollection, type Doc } from './workspaceCollection'

export type SongVariantDoc = Doc<SongVariant>

const variants = createWorkspaceCollection<SongVariant>('song-variants')

export const getVariantsDb = variants.getDb
export const switchVariantsWorkspace = variants.switchWorkspace
export const getAllVariants = variants.getAll
export const putVariant = variants.put
export const startVariantsSync = variants.startSync

function trackAttachmentId(trackId: string): string {
  return `track-${trackId}`
}

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
  }
  await putTrack(variant.id, trackMeta, legacyTrack)
  return { ...variant, tracks: [trackMeta] }
}

/**
 * Attachments are only carried forward to a new revision when the put body explicitly
 * includes their stub metadata - so track metadata updates always re-fetch the doc (with its
 * current `_attachments`) rather than going through the plain `putVariant`, which would drop
 * every attachment that put doesn't already know about.
 */
export async function putTrack(variantId: string, meta: TrackMeta, file: Blob): Promise<void> {
  const db = getVariantsDb()
  const before = await db.get(variantId)
  await db.putAttachment(variantId, trackAttachmentId(meta.id), before._rev, file, file.type)
  const after = await db.get(variantId)
  const tracks = [...after.tracks.filter((t) => t.id !== meta.id), meta]
  await db.put({ ...after, tracks })
}

export async function getTrack(variantId: string, trackId: string): Promise<Blob | null> {
  const db = getVariantsDb()
  try {
    return (await db.getAttachment(variantId, trackAttachmentId(trackId))) as Blob
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null
    throw err
  }
}

export async function removeTrack(variantId: string, trackId: string): Promise<void> {
  const db = getVariantsDb()
  const before = await db.get(variantId)
  if (before._attachments?.[trackAttachmentId(trackId)]) {
    await db.removeAttachment(variantId, trackAttachmentId(trackId), before._rev)
  }
  const after = await db.get(variantId)
  const tracks = after.tracks.filter((t) => t.id !== trackId)
  await db.put({ ...after, tracks })
}
