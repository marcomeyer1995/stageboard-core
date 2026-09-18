import { useEffect, useState } from 'react'
import type { WorkspaceSummary } from 'shared-types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Which band this specific Stage-Server's physical hardware currently serves, plus every band
 * the server hosts (for showing that band's name, not just its id). Shared between
 * WorkspaceHardwareSettings.tsx (the switch control) and BandManagementView.tsx's small
 * "Hardware auf diesem Server" indicator - both need the exact same two facts, and showing it
 * in the Band tab too is deliberate: that tab already has its own, unrelated "which workspace
 * is active *on this device*" concept, and the two are easy to conflate.
 */
export function useActiveWorkspaceHardware() {
  const listWorkspaces = useWorkspaceStore((state) => state.listWorkspaces)
  const fetchActiveWorkspaceHardware = useWorkspaceStore((state) => state.fetchActiveWorkspaceHardware)

  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

  async function reload() {
    const [list, status] = await Promise.all([listWorkspaces(), fetchActiveWorkspaceHardware()])
    setWorkspaces(list)
    setActiveWorkspaceId(status?.activeWorkspaceId ?? null)
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { workspaces, activeWorkspaceId, reload }
}
