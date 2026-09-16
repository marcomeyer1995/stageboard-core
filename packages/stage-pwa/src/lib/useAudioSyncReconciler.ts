import { useEffect, useMemo } from 'react'
import { cacheKey } from './audioCache'
import { scheduleReconcileAudioCache } from './audioStorageManager'
import { resolveTrackForEntry } from './computeQueue'
import { useQueue } from './queue'
import { useAudioPinsStore } from '../store/useAudioPinsStore'
import { useAudioSyncStore } from '../store/useAudioSyncStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

/**
 * Mounted once in App.tsx alongside the workspace-resource effects. Re-runs the cache
 * reconciliation whenever anything it depends on changes - the sync mode, the pinned songs,
 * the active setlist, or the catalog itself (a track can be added/removed at any time).
 *
 * Also always keeps whatever song is currently active in the (Gig-mode) queue cached, regardless
 * of sync mode - see computeTargetKeys's own doc comment for why: a reload must never depend on
 * a live network fetch for a song that's already playing.
 *
 * Goes through `scheduleReconcileAudioCache` (not `reconcileAudioCache` directly) - this effect
 * can fire many times in quick succession during PouchDB's initial sync, as `variants`/
 * `activeSetlist` arrive incrementally; without coalescing, each firing started its own full
 * catalog reconciliation, and several of them ended up racing each other, redundantly
 * re-downloading the same tracks in parallel (found live, 2026-09-16).
 */
export function useAudioSyncReconciler(workspaceId: string) {
  const mode = useAudioSyncStore((state) => state.modeFor(workspaceId))
  const pinnedSongIds = useAudioPinsStore((state) => state.pinsFor(workspaceId))
  const variants = useSongVariantsStore((state) => state.variants)
  const { activeSetlist, currentEntry, currentVariant } = useQueue()
  const trackOverride = useShowStateStore((state) => state.state.trackOverride)
  const currentTrack = resolveTrackForEntry(currentEntry, currentVariant, trackOverride)

  const alwaysKeepKeys = useMemo(() => {
    if (!currentVariant || !currentTrack) return new Set<string>()
    return new Set([cacheKey(currentVariant.id, currentTrack.id)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVariant?.id, currentTrack?.id])

  useEffect(() => {
    scheduleReconcileAudioCache(mode, variants, activeSetlist, pinnedSongIds, alwaysKeepKeys)
  }, [workspaceId, mode, variants, activeSetlist, pinnedSongIds, alwaysKeepKeys])
}
