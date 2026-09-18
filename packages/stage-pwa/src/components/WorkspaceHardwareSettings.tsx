import { useRef, useState } from 'react'
import type { WorkspaceSummary } from 'shared-types'
import { useStageServerStatus } from '../lib/useStageServerStatus'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { ResolveWorkspaceAdminDialog } from './ResolveWorkspaceAdminDialog'

interface ResolvedCredentials {
  username: string
  password: string
}

/**
 * Which band this physical Stage-Server's hardware (plugin sync, Discovery Mode's MIDI
 * watcher) currently serves - never more than one at a time (see
 * workspaceHardwareController.ts on the server; real case: Marco runs one box for two of his
 * own bands, never simultaneously). Lists every band the server knows about via
 * listWorkspaces(), not just whatever this device happens to be locally joined to.
 *
 * Resolves admin identity via `ResolveWorkspaceAdminDialog` (picked from that workspace's real
 * roster + a PIN, never a hand-typed username/password) - once for the band being closed (only
 * when a different one is currently active) and once for the band being opened, run
 * sequentially since the closing dialog's roster/PIN flow needs to fully resolve before the
 * opening one starts.
 */
export function WorkspaceHardwareSettings() {
  const { workspaces, activeWorkspaceId, reload } = useStageServerStatus()
  const activateWorkspaceHardware = useWorkspaceStore((state) => state.activateWorkspaceHardware)

  const [switching, setSwitching] = useState(false)
  const [pendingDialog, setPendingDialog] = useState<{ workspaceId: string; workspaceName: string } | null>(null)
  // A plain local variable wouldn't survive the re-render that actually mounts the dialog (a
  // fresh one gets created, and closed-over, on every render) - this needs a ref specifically
  // so the *same* object is still there once React commits the state update above and the
  // dialog's onResolved prop is created for real.
  const resolveDialogRef = useRef<((credentials: ResolvedCredentials | null) => void) | null>(null)

  async function resolveAdmin(workspace: WorkspaceSummary): Promise<ResolvedCredentials | null> {
    return new Promise((resolve) => {
      setPendingDialog({ workspaceId: workspace.workspaceId, workspaceName: workspace.workspaceName })
      resolveDialogRef.current = (credentials) => {
        setPendingDialog(null)
        resolve(credentials)
      }
    })
  }

  async function handleSelect(workspace: WorkspaceSummary) {
    if (workspace.workspaceId === activeWorkspaceId || switching) return

    const closingWorkspace =
      activeWorkspaceId && activeWorkspaceId !== workspace.workspaceId
        ? workspaces?.find((w) => w.workspaceId === activeWorkspaceId)
        : undefined

    setSwitching(true)
    try {
      let closing: ResolvedCredentials | null = null
      if (closingWorkspace) {
        closing = await resolveAdmin(closingWorkspace)
        if (!closing) return
      }

      const opening = await resolveAdmin(workspace)
      if (!opening) return

      const ok = await activateWorkspaceHardware(
        workspace.workspaceId,
        opening.username,
        opening.password,
        closing?.username,
        closing?.password,
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

      {pendingDialog && (
        <ResolveWorkspaceAdminDialog
          workspaceId={pendingDialog.workspaceId}
          workspaceName={pendingDialog.workspaceName}
          onResolved={(credentials) => resolveDialogRef.current?.(credentials)}
        />
      )}
    </div>
  )
}
