import { parseTrackKey, trackKey } from 'sync-host'
import type { AudioStorageBackend } from '../lib/audioStorageBackend'

/**
 * The audio a tablet host serves and takes (#781, #954): **its own playback cache**, the store this device plays
 * from - not a second one. A device that hosts keeps the sync mode "full" (useAudioSyncReconciler), so the audio
 * manager wants every track the band lists and evicts nothing of it; and because the key is the same one the
 * manager builds (`variant:track@rev`, sync-host's `trackKey`), an upload is simply a file the device's own sync
 * already expects. An upload arrives without a revision: the host takes it from the band's song list when that
 * names one, else keeps it under the plain key until it does.
 */
export interface HostAudioStore {
  get(variantId: string, trackId: string): Promise<Uint8Array | null>
  put(variantId: string, trackId: string, data: Uint8Array): Promise<void>
  remove(variantId: string, trackId: string): Promise<void>
}

export function createHostAudio(deps: {
  backend: AudioStorageBackend
  /** The file revision the band's song list names for the track, if any. A throw means "cannot tell". */
  revisionOf: (variantId: string, trackId: string) => Promise<number | undefined>
}): HostAudioStore {
  /** Every key the cache holds for this track, whatever revision. */
  const keysOf = async (variantId: string, trackId: string) =>
    (await deps.backend.listKeys()).filter((key) => {
      const held = parseTrackKey(key)
      return held.variantId === variantId && held.trackId === trackId
    })

  return {
    async get(variantId, trackId) {
      // The newest revision wins.
      const newest = (await keysOf(variantId, trackId)).sort((a, b) => (parseTrackKey(b).fileRev ?? 0) - (parseTrackKey(a).fileRev ?? 0))[0]
      const blob = newest ? await deps.backend.get(newest) : null
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null
    },
    async put(variantId, trackId, data) {
      const rev = await deps.revisionOf(variantId, trackId).catch(() => undefined)
      const key = trackKey(variantId, trackId, rev)
      await deps.backend.set(key, new Blob([data as BlobPart]))
      // The new file replaces every older one of the track.
      for (const old of await keysOf(variantId, trackId)) if (old !== key) await deps.backend.remove(old)
    },
    async remove(variantId, trackId) {
      for (const key of await keysOf(variantId, trackId)) await deps.backend.remove(key)
    },
  }
}
