import { getCached, listCachedKeys, removeCached, setCached } from './audioCache'

/**
 * The seam #49 was actually asked for: everything that reads/writes cached audio bytes goes
 * through this interface, not audioCache.ts directly, so a future native (Capacitor/Tauri)
 * shell can plug in its own filesystem-backed store without touching audioStorageManager.ts.
 */
export interface AudioStorageBackend {
  get(key: string): Promise<Blob | null>
  set(key: string, blob: Blob): Promise<void>
  remove(key: string): Promise<void>
  listKeys(): Promise<string[]>
}

export const webAudioStorageBackend: AudioStorageBackend = {
  get: getCached,
  set: setCached,
  remove: removeCached,
  listKeys: listCachedKeys,
}

/**
 * Always the web backend for now - no native wrapper exists anywhere in this project yet to
 * detect. When one lands, this single return point is where it picks between them (e.g. via
 * a Capacitor.isNativePlatform() check), not a scatter of call sites.
 */
export function getAudioStorageBackend(): AudioStorageBackend {
  return webAudioStorageBackend
}
