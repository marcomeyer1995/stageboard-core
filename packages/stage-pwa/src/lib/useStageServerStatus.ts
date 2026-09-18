import { useEffect, useState } from 'react'
import type { WorkspaceSummary } from 'shared-types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export type StageServerReachability = 'loading' | 'reachable' | 'unreachable'

/**
 * Everything the UI needs to know about this specific physical Stage-Server: whether it's
 * reachable at all, its own address/name, every band it hosts, and which one's hardware
 * (plugin sync, Discovery Mode's MIDI watcher) it currently serves. Shared between
 * WorkspaceHardwareSettings.tsx (the switch control), BandManagementView.tsx's "Hardware auf
 * diesem Server" indicator (deliberately shown there too - that tab already has its own,
 * unrelated "which workspace is active *on this device*" concept, and the two are easy to
 * conflate), and DeviceLedgerView.tsx's "this is the Stage-Server itself" row.
 *
 * `status` is `'reachable'` as soon as *either* underlying fetch actually got a response - a
 * server that's up but has never had a workspace activated on it is still reachable, just with
 * `activeWorkspaceId: null`. It's `'unreachable'` only once both have failed (which also covers
 * "no Stage-Server configured at all" - there's nothing meaningfully different to show for that
 * case here).
 */
export function useStageServerStatus() {
  const listWorkspaces = useWorkspaceStore((state) => state.listWorkspaces)
  const fetchActiveWorkspaceHardware = useWorkspaceStore((state) => state.fetchActiveWorkspaceHardware)
  const fetchServerInfo = useWorkspaceStore((state) => state.fetchServerInfo)

  const [status, setStatus] = useState<StageServerReachability>('loading')
  const [lanIp, setLanIp] = useState<string | null>(null)
  const [hostname, setHostname] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

  async function reload() {
    const [list, activeStatus, serverInfo] = await Promise.all([
      listWorkspaces(),
      fetchActiveWorkspaceHardware(),
      fetchServerInfo(),
    ])
    setWorkspaces(list)
    setActiveWorkspaceId(activeStatus?.activeWorkspaceId ?? null)
    setLanIp(serverInfo?.lanIp ?? null)
    setHostname(serverInfo?.hostname ?? null)
    setStatus(activeStatus || serverInfo ? 'reachable' : 'unreachable')
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeWorkspaceName = workspaces?.find((w) => w.workspaceId === activeWorkspaceId)?.workspaceName ?? null

  return { status, lanIp, hostname, workspaces, activeWorkspaceId, activeWorkspaceName, reload }
}
