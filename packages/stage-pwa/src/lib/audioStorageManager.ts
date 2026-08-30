import type { Setlist, SongVariant } from 'shared-types'
import { fetchTrack } from './audioClient'
import { cacheKey } from './audioCache'
import { getAudioStorageBackend } from './audioStorageBackend'
import type { AudioSyncMode } from '../store/useAudioSyncStore'

export interface StorageEstimate {
  usageBytes: number
  quotaBytes: number
}

/** Fraction of the device's total storage quota this app treats as safe to fill with audio -
 * leaves headroom for the rest of the app's own PouchDB data and general OS/browser pressure.
 * Not a StageBoard spec number (none exists), a conservative default worth tuning later. */
export const SAFE_QUOTA_FRACTION = 0.8

/** `null` when the API is unsupported (older Safari) or reports nothing usable - callers
 * treat that as "can't validate," not "block everything" (graceful degradation, matches
 * useWakeLock.ts's 'wakeLock' in navigator feature-detection pattern). */
export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (!('storage' in navigator) || typeof navigator.storage.estimate !== 'function') return null
  try {
    const { usage, quota } = await navigator.storage.estimate()
    if (usage === undefined || quota === undefined) return null
    return { usageBytes: usage, quotaBytes: quota }
  } catch {
    return null
  }
}

/** Sums every track's sizeBytes across the whole catalog. Tracks without a known size
 * (uploaded before this field existed) are excluded, not counted as zero. */
export function getCatalogSizeBytes(variants: SongVariant[]): number {
  return variants
    .flatMap((variant) => variant.tracks)
    .reduce((sum, track) => sum + (track.sizeBytes ?? 0), 0)
}

/** No estimate available means "allow" - see getStorageEstimate's doc comment. */
export function isFullSyncSafe(
  catalogSizeBytes: number,
  estimate: StorageEstimate | null,
): boolean {
  if (!estimate) return true
  return catalogSizeBytes <= estimate.quotaBytes * SAFE_QUOTA_FRACTION
}

function resolveVariant(
  songId: string,
  variantId: string | null,
  variants: SongVariant[],
): SongVariant | null {
  const explicit = variantId
    ? variants.find((v) => v.id === variantId && v.songId === songId)
    : undefined
  return explicit ?? variants.find((v) => v.songId === songId && v.isDefault) ?? null
}

/**
 * The set of cache keys that *should* be cached right now, given the sync mode - pure, so it
 * can be unit-tested without touching IndexedDB or the network. "Selective" targets the
 * active setlist's songs plus manually pinned songs, each resolved to its actual variant the
 * same way the live queue does (see computeQueue.ts's resolveVariantForEntry).
 */
export function computeTargetKeys(
  mode: AudioSyncMode,
  variants: SongVariant[],
  activeSetlist: Setlist | null,
  pinnedSongIds: string[],
): Set<string> {
  if (mode === 'none') return new Set()
  if (mode === 'full') {
    return new Set(variants.flatMap((v) => v.tracks.map((t) => cacheKey(v.id, t.id))))
  }

  const keys = new Set<string>()
  const seenSongIds = new Set<string>()
  const addSong = (songId: string, variantId: string | null) => {
    seenSongIds.add(songId)
    const variant = resolveVariant(songId, variantId, variants)
    if (!variant) return
    for (const track of variant.tracks) keys.add(cacheKey(variant.id, track.id))
  }

  for (const entry of activeSetlist?.entries ?? []) addSong(entry.songId, entry.variantId)
  for (const songId of pinnedSongIds) {
    if (!seenSongIds.has(songId)) addSong(songId, null)
  }
  return keys
}

/**
 * Brings the local cache in line with the current sync mode: fetches anything in the target
 * set that isn't cached yet, and evicts anything cached that no longer belongs. This eviction
 * is the actual "quota-aware" behavior #30 deferred to this issue - without it, switching
 * from Full to Selective/None would only stop the cache from growing further, not shrink it.
 * Safe to call redundantly (e.g. on every relevant state change); each call is independent.
 */
export async function reconcileAudioCache(
  mode: AudioSyncMode,
  variants: SongVariant[],
  activeSetlist: Setlist | null,
  pinnedSongIds: string[],
): Promise<void> {
  const backend = getAudioStorageBackend()
  const target = computeTargetKeys(mode, variants, activeSetlist, pinnedSongIds)
  const cached = new Set(await backend.listKeys())

  await Promise.all([...cached].filter((key) => !target.has(key)).map((key) => backend.remove(key)))

  const toFetch = [...target].filter((key) => !cached.has(key))
  await Promise.all(
    toFetch.map(async (key) => {
      const [variantId, trackId] = key.split(':')
      const blob = await fetchTrack(variantId, trackId)
      if (blob) await backend.set(key, blob)
    }),
  )
}
