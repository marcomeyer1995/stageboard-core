import { useMemo } from 'react'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Escape hatch for App.tsx's three onboarding gates (JoinBandView, RosterSetupView,
 * ProfileRolePickerView) - none of them offer a way back to the main app on their own, which
 * traps a device on this screen with no obvious way out if it ever lands there by switching
 * *away* from an already-working band (found live, 2026-08-30: switching to a band with no
 * stored password - e.g. a stale entry from before #21's join flow existed - stranded the
 * switcher's own menu behind the gate). Lists every other workspace this device already has
 * a stored credential for; picking one just calls `setActiveWorkspace`, same as
 * BandManagementView.tsx's band list.
 */
export function BackToWorkingBandLink() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActiveWorkspace = useWorkspaceStore((state) => state.setActiveWorkspace)
  // Select the raw (stable-reference) array, not a filtered derivation - a selector that
  // allocates a new array every call breaks useSyncExternalStore's reference-equality check
  // and spins into "Maximum update depth exceeded" (found immediately by this component's own
  // tests). The filter itself is cheap enough to just redo per render via useMemo instead.
  const workspaces = useWorkspaceStore((state) => state.workspaces)
  const otherReadyWorkspaces = useMemo(
    () => workspaces.filter((w) => w.id !== activeWorkspaceId && w.couchPassword),
    [workspaces, activeWorkspaceId],
  )

  if (otherReadyWorkspaces.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {otherReadyWorkspaces.map((w) => (
        <button
          key={w.id}
          type="button"
          onClick={() => setActiveWorkspace(w.id)}
          className="text-xs text-ink-faint underline"
        >
          ← Zurück zu {w.name}
        </button>
      ))}
    </div>
  )
}
