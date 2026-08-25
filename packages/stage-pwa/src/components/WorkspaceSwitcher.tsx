import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Band selection. Lives inside AppMenu now, not floating on its own - switching bands
 * happens at the start of a session, not often enough to earn permanent screen space
 * on a touch device (see App.tsx).
 */
export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace)

  return (
    <div className="flex items-center gap-2">
      <select
        className="h-12 flex-1 rounded-sb bg-control px-3 text-base text-ink-soft"
        value={activeWorkspaceId}
        onChange={(e) => setActiveWorkspace(e.target.value)}
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          const name = window.prompt('Name der neuen Band?')
          if (name?.trim()) addWorkspace(name.trim())
        }}
        title="Neue Band anlegen"
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-sb bg-control text-xl text-ink-soft hover:bg-control-hover"
      >
        +
      </button>
    </div>
  )
}
