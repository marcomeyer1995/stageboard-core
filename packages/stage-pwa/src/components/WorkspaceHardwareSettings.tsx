import { useState } from 'react'
import type { WorkspaceSummary } from 'shared-types'
import { useActiveWorkspaceHardware } from '../lib/useActiveWorkspaceHardware'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Which band this physical Stage-Server's hardware (plugin sync, Discovery Mode's MIDI
 * watcher) currently serves - never more than one at a time (see
 * workspaceHardwareController.ts on the server; real case: Marco runs one box for two of his
 * own bands, never simultaneously). Lists every band the server knows about via
 * listWorkspaces(), not just whatever this device happens to be locally joined to - switching
 * to the *other* band is exactly the case where this device may not already be admin there, so
 * activating always asks for fresh admin credentials rather than reusing any stored ones.
 *
 * Asks for two sets of credentials when switching away from a band that's currently active:
 * the target band's own admin (always) and the currently-active band's admin (proof that this
 * caller may interrupt whatever's actually live right now) - see the matching backend-side
 * reasoning in index.ts.
 */
export function WorkspaceHardwareSettings() {
  const { workspaces, activeWorkspaceId, reload } = useActiveWorkspaceHardware()
  const activateWorkspaceHardware = useWorkspaceStore((state) => state.activateWorkspaceHardware)
  const promptFields = useDialogStore((state) => state.promptFields)

  const [switching, setSwitching] = useState(false)

  async function handleSelect(workspace: WorkspaceSummary) {
    if (workspace.workspaceId === activeWorkspaceId || switching) return

    const closingWorkspace =
      activeWorkspaceId && activeWorkspaceId !== workspace.workspaceId
        ? workspaces?.find((w) => w.workspaceId === activeWorkspaceId)
        : undefined

    const fields = [
      ...(closingWorkspace
        ? [
            {
              key: 'closingAdminUsername',
              label: `Admin-Benutzername (${closingWorkspace.workspaceName}, wird deaktiviert)`,
            },
            { key: 'closingAdminPassword', label: `Admin-Passwort (${closingWorkspace.workspaceName})`, type: 'password' as const },
          ]
        : []),
      { key: 'openingAdminUsername', label: `Admin-Benutzername (${workspace.workspaceName})` },
      { key: 'openingAdminPassword', label: `Admin-Passwort (${workspace.workspaceName})`, type: 'password' as const },
    ]

    const result = await promptFields(`Hardware für "${workspace.workspaceName}" aktivieren`, fields)
    if (!result?.openingAdminUsername || !result?.openingAdminPassword) return
    if (closingWorkspace && (!result.closingAdminUsername || !result.closingAdminPassword)) return

    setSwitching(true)
    try {
      const ok = await activateWorkspaceHardware(
        workspace.workspaceId,
        result.openingAdminUsername,
        result.openingAdminPassword,
        result.closingAdminUsername,
        result.closingAdminPassword,
      )
      if (ok) await reload()
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {workspaces === null && <p className="text-sm text-ink-muted">Lade…</p>}
      {workspaces?.length === 0 && <p className="text-sm text-ink-muted">Keine Bands auf diesem Stage-Server gefunden.</p>}
      {workspaces && workspaces.length > 0 && (
        <ul className="space-y-2">
          {workspaces.map((workspace) => {
            const isActive = workspace.workspaceId === activeWorkspaceId
            return (
              <li key={workspace.workspaceId}>
                <button
                  type="button"
                  disabled={isActive || switching}
                  onClick={() => void handleSelect(workspace)}
                  className="flex w-full items-center justify-between rounded-sb border border-line bg-surface px-4 py-3 text-left font-semibold hover:bg-control-hover disabled:opacity-50"
                >
                  <span>{workspace.workspaceName}</span>
                  {isActive && <span className="text-xs font-normal text-ink-faint">Aktiv</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
