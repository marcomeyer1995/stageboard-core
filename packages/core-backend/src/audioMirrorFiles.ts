import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { trackKey } from 'sync-host'
import { audioStorageDir, isSafeAudioId, writeAudioFile } from './audioStore.js'

/**
 * The files side of the backup's audio mirror (audioMirror.ts, #919): the audio folder with a small
 * marker per track that records which `fileRev` the stored file was saved with. The marker is
 * `<trackId>.rev` next to the file - a track id has no dot (`isSafeAudioId`), so it can never be taken
 * for one. What the folder holds is reported as **track keys** (`sync-host`'s `trackKey`), the form every
 * store of tracks is compared in (#954).
 */

const markerPath = (variantId: string, trackId: string) => join(audioStorageDir(), variantId, `${trackId}.rev`)

/** The revision a track's marker records, or null (no marker, e.g. put there by an upload). */
async function revisionOf(variantId: string, trackId: string): Promise<number | null> {
  try {
    const rev = Number((await readFile(markerPath(variantId, trackId), 'utf8')).trim())
    return Number.isInteger(rev) && rev > 0 ? rev : null
  } catch {
    return null
  }
}

/** Every track the folder holds, as a key with the revision it was saved with. Files are only looked at, never read:
 * this runs for every track every few seconds. */
export async function listHeldKeys(): Promise<string[]> {
  const root = audioStorageDir()
  const keys: string[] = []
  for (const variantId of await readdir(root).catch(() => [] as string[])) {
    if (!isSafeAudioId(variantId)) continue
    for (const name of await readdir(join(root, variantId)).catch(() => [] as string[])) {
      if (!isSafeAudioId(name)) continue // also skips every marker: its name has a dot
      const info = await stat(join(root, variantId, name)).catch(() => null)
      if (info === null || !info.isFile()) continue
      keys.push(trackKey(variantId, name, (await revisionOf(variantId, name)) ?? undefined))
    }
  }
  return keys
}

export async function saveMirrorFile(variantId: string, trackId: string, rev: number | null, data: Buffer): Promise<void> {
  if (!isSafeAudioId(variantId) || !isSafeAudioId(trackId)) throw new Error('Invalid variantId or trackId')
  await writeAudioFile(variantId, trackId, data)
  await mkdir(join(audioStorageDir(), variantId), { recursive: true })
  await writeFile(markerPath(variantId, trackId), rev === null ? '' : String(rev))
}
