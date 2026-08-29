import { useEffect } from 'react'
import { reconcileAudioCache } from './audioStorageManager'
import { useQueue } from './queue'
import { useAudioPinsStore } from '../store/useAudioPinsStore'
import { useAudioSyncStore } from '../store/useAudioSyncStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

/**
 * Mounted once in App.tsx alongside the workspace-resource effects. Re-runs the cache
 * reconciliation whenever anything it depends on changes - the sync mode, the pinned songs,
 * the active setlist, or the catalog itself (a track can be added/removed at any time).
 */
export function useAudioSyncReconciler(workspaceId: string) {
  const mode = useAudioSyncStore((state) => state.modeFor(workspaceId))
  const pinnedSongIds = useAudioPinsStore((state) => state.pinsFor(workspaceId))
  const variants = useSongVariantsStore((state) => state.variants)
  const { activeSetlist } = useQueue()

  useEffect(() => {
    void reconcileAudioCache(mode, variants, activeSetlist, pinnedSongIds)
  }, [workspaceId, mode, variants, activeSetlist, pinnedSongIds])
}
