import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { PickRow } from './PickRow'

/**
 * "Band: …" in the ☰ drawer (Marco, 2026-10-16): which band this device shows, and switching it
 * right there - like a tap on a band in System → Band. Locked while a song plays: everything
 * changes with the band (songs, setlists, master).
 */
export function BandPickRow() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)
  const playing = useShowStateStore((state) => state.state.playbackStatus === 'playing')
  if (workspaces.length === 0) return null
  return (
    <PickRow
      title="Band"
      items={workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name }))}
      activeId={activeId}
      onPick={(id) => id && setActiveWorkspace(id)}
      readOnly={workspaces.length < 2}
      locked={playing}
      lockedHint="Während ein Song läuft, bleibt die Band."
    />
  )
}
