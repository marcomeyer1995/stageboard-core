import { useEffect } from 'react'
import type { TrackedSync } from './trackedSync'

/**
 * Runs a resource's (re-)init + sync-start whenever the active workspace changes,
 * cancelling the previous sync first. Shared by every workspace-scoped store
 * (songs, setlists, show-state) so App.tsx doesn't repeat this three times.
 *
 * `restartKey` restarts it too when it changes: a resource that holds a live stream to the Stage-Server
 * (`EventSource`) passes the server address, because after a host takeover the app moves to the other
 * host (hostFollow.ts) and the stream would otherwise keep retrying the dead one - the master would never
 * be confirmed again (#947, found with two devices following a tablet host).
 */
export function useWorkspaceResource(
  init: (workspaceId: string) => Promise<void>,
  startSync: (workspaceId: string) => TrackedSync | null,
  workspaceId: string,
  restartKey?: string,
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
  }, [workspaceId, init, startSync, restartKey])
}
