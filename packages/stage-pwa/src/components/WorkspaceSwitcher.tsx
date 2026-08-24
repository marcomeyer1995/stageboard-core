import { useWorkspaceStore } from '../store/useWorkspaceStore'

export function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace)

  return (
    <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
      <select
        className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300"
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
        className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
      >
        +
      </button>
    </div>
  )
}
