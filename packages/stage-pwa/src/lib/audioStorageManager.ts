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
 *
 * `alwaysKeepKeys` is unioned in regardless of mode - including "None", which otherwise targets
 * nothing at all. Whatever's actively playing right now must survive a reload without a live
 * network fetch (Marco, explicit request, 2026-09-16: "it is important to continue the show" -
 * a reconciler running purely off sync-mode targeting had been evicting a song's own cached
 * audio while it was still the one playing, so a reload forced a full re-download - or, if the
 * Stage-Server happened to be unreachable at that exact moment, no recovery at all).
 */
export function computeTargetKeys(
  mode: AudioSyncMode,
  variants: SongVariant[],
  activeSetlist: Setlist | null,
  pinnedSongIds: string[],
  alwaysKeepKeys: ReadonlySet<string> = new Set(),
): Set<string> {
  const keys = new Set<string>(alwaysKeepKeys)

  if (mode === 'full') {
    for (const variant of variants) {
      for (const track of variant.tracks) keys.add(cacheKey(variant.id, track.id))
    }
    return keys
  }
  if (mode === 'none') return keys

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
 *
 * NOT safe to call redundantly while a previous call is still running - each invocation reads
 * `backend.listKeys()` fresh and re-fetches everything it doesn't see there *yet*, so two
 * overlapping calls both start from the same "nothing new cached" snapshot and both re-download
 * the same tracks in parallel, each fighting the other for bandwidth (found live, 2026-09-16:
 * useAudioSyncReconciler.ts's effect re-fires many times in quick succession while PouchDB's
 * initial sync streams in `variants`/`activeSetlist` updates - several full "Full"-mode
 * reconciliations ended up racing each other, all re-downloading the same ~20-track, tens-of-MB
 * catalog concurrently, so even the one track meant to be prioritized sat behind a many-second
 * bandwidth pile-up). Callers that may fire in quick succession should go through
 * `scheduleReconcileAudioCache` below instead of calling this directly.
 */
export async function reconcileAudioCache(
  mode: AudioSyncMode,
  variants: SongVariant[],
  activeSetlist: Setlist | null,
  pinnedSongIds: string[],
  alwaysKeepKeys: ReadonlySet<string> = new Set(),
): Promise<void> {
  const backend = getAudioStorageBackend()
  const target = computeTargetKeys(mode, variants, activeSetlist, pinnedSongIds, alwaysKeepKeys)
  const cached = new Set(await backend.listKeys())

  await Promise.all([...cached].filter((key) => !target.has(key)).map((key) => backend.remove(key)))

  async function fetchAndCache(key: string): Promise<void> {
    const [variantId, trackId] = key.split(':')
    const blob = await fetchTrack(variantId, trackId)
    if (blob) await backend.set(key, blob)
  }

  const toFetch = [...target].filter((key) => !cached.has(key))
  // The currently-playing track (if any) fetches first, awaited on its own - a live show can't
  // wait behind the rest of a large "Full" catalog sync for the one file it actually needs
  // right now, and every fetch otherwise competes for the same bandwidth (core-backend serves
  // audio over one multiplexed HTTP/2 connection, so issuing them all via one Promise.all gives
  // no real priority to any of them).
  await Promise.all(toFetch.filter((key) => alwaysKeepKeys.has(key)).map(fetchAndCache))

  // Everything else downloads one track at a time, never all at once (found live, 2026-09-18:
  // right after a band switch the device started several of these at once, and for the ~27
  // seconds they ran the WiFi link and the one shared HTTP/2 connection were saturated - a
  // status request the server answers in 1 ms took 3.5 s, its first byte arriving 5-9 s late).
  // Background caching has no deadline, so it must not starve the interactive requests (status,
  // PouchDB sync, the live streams) sharing that connection. `fetchTrack` never throws (a failed
  // download is a `null`), so one bad track can't stop the ones after it.
  for (const key of toFetch.filter((key) => !alwaysKeepKeys.has(key))) {
    await fetchAndCache(key)
  }
}

type ReconcileArgs = Parameters<typeof reconcileAudioCache>

let reconcileInFlight: Promise<void> | null = null
let pendingReconcileArgs: ReconcileArgs | null = null

/**
 * Serializes `reconcileAudioCache` calls: if one is already running, only the latest set of
 * args is remembered, and exactly one more pass runs once the current one finishes - never two
 * full reconciliations racing each other (see `reconcileAudioCache`'s own doc comment for why
 * that matters). This is what `useAudioSyncReconciler.ts` calls on every dependency change,
 * rather than `reconcileAudioCache` directly - safe to call as often as inputs change, including
 * many times within the same second.
 */
export function scheduleReconcileAudioCache(...args: ReconcileArgs): void {
  pendingReconcileArgs = args
  if (reconcileInFlight) return

  async function runQueued(): Promise<void> {
    while (pendingReconcileArgs) {
      const next = pendingReconcileArgs
      pendingReconcileArgs = null
      await reconcileAudioCache(...next)
    }
  }
  reconcileInFlight = runQueued().finally(() => {
    reconcileInFlight = null
  })
}

/** Test-only escape hatch - lets a test await the currently scheduled/running reconciliation
 * (including any queued trailing run) instead of racing it with fixed delays. */
export function __getReconcileInFlightForTests(): Promise<void> | null {
  return reconcileInFlight
}

/** Test-only reset - the in-flight/pending state above is module-level (deliberately, it must
 * survive across every caller and every `useAudioSyncReconciler` render), so it would otherwise
 * leak between tests. */
export function __resetReconcileSchedulerForTests(): void {
  reconcileInFlight = null
  pendingReconcileArgs = null
}
