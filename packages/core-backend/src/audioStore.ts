import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Where song-variant audio track binaries live now (see #30): a plain directory tree on
 * the Stage-Server's own disk, not a PouchDB attachment. Every tablet used to receive every
 * byte of every band's audio catalog through the `song-variants` live sync stream whether it
 * wanted it or not - that's the "PouchDB Bloat" problem #30 exists to fix. CouchDB itself was
 * considered (it already has dormant attachment helpers in couch.ts) and rejected: CouchDB
 * stores attachments inline in the same file as the database, so compaction - which it needs
 * periodically - rewrites every attachment byte along with it. That's a real bottleneck at
 * the catalog sizes #30 is worried about ("10 GB catalog"), and the one benefit CouchDB would
 * have bought (automatic replication to a future second Stage-Server) is for a feature
 * (docs/01 §2.3 Touring-tier HA) that doesn't exist yet.
 */
/** Read fresh on every call, not cached at module scope - tests point this at a fresh temp
 * dir per run by setting the env var before calling into this module. */
function audioStorageDir(): string {
  return process.env.AUDIO_STORAGE_DIR ?? './data/audio'
}

/** Same charset randomId() (stage-pwa) and the legacy fixed slugs (e.g. 'backing-track',
 * 'default-prompter') produce - both become path segments below, so this is the
 * path-traversal guard: reject anything that isn't safely just a filename component. */
const SAFE_ID = /^[a-zA-Z0-9-]+$/

export function isSafeAudioId(id: string): boolean {
  return SAFE_ID.test(id)
}

function audioFilePath(variantId: string, trackId: string): string {
  return join(audioStorageDir(), variantId, trackId)
}

export async function writeAudioFile(
  variantId: string,
  trackId: string,
  data: Buffer,
): Promise<void> {
  const path = audioFilePath(variantId, trackId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, data)
}

/** `null` when the track has no stored audio - "not found", not an error. */
export async function readAudioFile(variantId: string, trackId: string): Promise<Buffer | null> {
  try {
    return await readFile(audioFilePath(variantId, trackId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Deleting a missing file is a no-op, matching workspaceCollection.ts's `remove` convention -
 * callers don't have to check existence first. */
export async function deleteAudioFile(variantId: string, trackId: string): Promise<void> {
  await rm(audioFilePath(variantId, trackId), { force: true })
}
