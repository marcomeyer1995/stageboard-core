import { useEffect } from 'react'

/**
 * Runs a resource's (re-)init + sync-start whenever the active workspace changes,
 * cancelling the previous sync first. Shared by every workspace-scoped store
 * (songs, setlists, show-state) so App.tsx doesn't repeat this three times.
 */
export function useWorkspaceResource<T extends object>(
  init: (workspaceId: string) => Promise<void>,
  startSync: (workspaceId: string) => PouchDB.Replication.Sync<T> | null,
  workspaceId: string,
) {
  useEffect(() => {
    let cancelled = false
    let sync: PouchDB.Replication.Sync<T> | null = null

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
