import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Band selection only - which band this device is currently showing. Lives inside AppMenu's
 * "Wer bin ich" section, not floating on its own - switching bands happens at the start of a
 * session, not often enough to earn permanent screen space on a touch device (see App.tsx).
 *
 * Creating/renaming/inviting-to a band moved to SystemView.tsx's "Band" tab (2026-08-30 menu
 * follow-up, at Marco's request) - this component is deliberately just a picker now, nothing
 * that mutates anything.
 */
export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)

  return (
    <select
      className="h-12 w-full rounded-sb bg-control px-3 text-base text-ink-soft"
      value={activeWorkspaceId}
      onChange={(e) => setActiveWorkspace(e.target.value)}
    >
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}
        </option>
      ))}
    </select>
  )
}
