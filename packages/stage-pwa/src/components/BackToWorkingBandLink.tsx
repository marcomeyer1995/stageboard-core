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
 *
 * `onNavigate` (#68 follow-up, found live): for the three *forced* App.tsx gates, switching
 * `activeWorkspaceId` is enough by itself - the gate condition itself is derived from the
 * active workspace, so picking a working one makes the gate re-evaluate false on its own,
 * with nothing left rendering it. That assumption breaks for `JoinBandView.tsx`'s new
 * *voluntary* overlay usage (opened from `BandManagementView.tsx`, on top of an already-normal
 * app): its visibility is separate local state in the caller, not derived from
 * `activeWorkspaceId` at all, so `setActiveWorkspace` alone left the overlay sitting there
 * unchanged - clicking "Zurück zu X" visibly did nothing. `onNavigate` (optional, so the three
 * unaffected forced-gate call sites need no change) lets a caller close its own overlay too.
 */
export function BackToWorkingBandLink({ onNavigate }: { onNavigate?: () => void } = {}) {
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
          onClick={() => {
            setActiveWorkspace(w.id)
            onNavigate?.()
          }}
          className="text-xs text-ink-faint underline"
        >
          ← Zurück zu {w.name}
        </button>
      ))}
    </div>
  )
}
