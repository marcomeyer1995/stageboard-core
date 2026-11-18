import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { audioStorageDir, isSafeAudioId, writeAudioFile } from './audioStore.js'
import type { MirrorTrack } from './audioMirror.js'

/**
 * The files side of the backup's audio mirror (audioMirror.ts, #919): which tracks the replicated
 * song variants list, and the audio folder with a small marker per track that records which
 * `fileRev` the stored file was saved with. The marker is `<trackId>.rev` next to the file - a track
 * id has no dot (`isSafeAudioId`), so it can never be taken for one.
 */

/** The tracks the song-variant documents list, ones with ids that could leave the audio folder dropped. */
export function mirrorTracksOf(docs: readonly Record<string, unknown>[]): MirrorTrack[] {
  const out: MirrorTrack[] = []
  for (const doc of docs) {
    if (typeof doc._id !== 'string' || !doc._id.startsWith('song-variants:') || typeof doc.id !== 'string' || !isSafeAudioId(doc.id)) continue
    for (const track of Array.isArray(doc.tracks) ? (doc.tracks as Record<string, unknown>[]) : []) {
      if (typeof track?.id !== 'string' || !isSafeAudioId(track.id)) continue
      out.push({ variantId: doc.id, trackId: track.id, fileRev: typeof track.fileRev === 'number' ? track.fileRev : undefined })
    }
  }
  return out
}

const markerPath = (variantId: string, trackId: string) => join(audioStorageDir(), variantId, `${trackId}.rev`)

/** null = no file; else the revision the file was saved with (null = no marker, e.g. put there by an upload). */
export async function readLocalRevision(variantId: string, trackId: string): Promise<{ rev: number | null } | null> {
  if (!isSafeAudioId(variantId) || !isSafeAudioId(trackId)) return null
  // Only looked at, never read: this runs for every track every few seconds.
  const info = await stat(join(audioStorageDir(), variantId, trackId)).catch(() => null)
  if (info === null || !info.isFile()) return null
  try {
    const rev = Number((await readFile(markerPath(variantId, trackId), 'utf8')).trim())
    return { rev: Number.isInteger(rev) && rev > 0 ? rev : null }
  } catch {
    return { rev: null }
  }
}

export async function saveMirrorFile(variantId: string, trackId: string, rev: number | null, data: Buffer): Promise<void> {
  if (!isSafeAudioId(variantId) || !isSafeAudioId(trackId)) throw new Error('Invalid variantId or trackId')
  await writeAudioFile(variantId, trackId, data)
  await mkdir(join(audioStorageDir(), variantId), { recursive: true })
  await writeFile(markerPath(variantId, trackId), rev === null ? '' : String(rev))
}
