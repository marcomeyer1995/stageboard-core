import { useEffect } from 'react'
import type { TrackedSync } from './trackedSync'

/**
 * Runs a resource's (re-)init + sync-start whenever the active workspace changes,
 * cancelling the previous sync first. Shared by every workspace-scoped store
 * (songs, setlists, show-state) so App.tsx doesn't repeat this three times.
 */
export function useWorkspaceResource(
  init: (workspaceId: string) => Promise<void>,
  startSync: (workspaceId: string) => TrackedSync | null,
  workspaceId: string,
) {
  useEffect(() => {
    let cancelled = false
    let sync: TrackedSync | null = null

    init(workspaceId).then(() => {
      if (cancelled) return
      sync = startSync(workspaceId)
    })

    return () => {
      cancelled = true
      sync?.cancel()
    }
  }, [workspaceId, init, startSync])
}
