import { useState } from 'react'
import { useStageServerStatus } from '../lib/useStageServerStatus'
import { SwitchServerBandWizard } from './SwitchServerBandWizard'

/**
 * Which band this physical Stage-Server's hardware (plugin sync, Discovery Mode's MIDI watcher)
 * currently serves - never more than one at a time (see workspaceHardwareController.ts on the
 * server; real case: Marco runs one box for two of his own bands, never simultaneously). Just the
 * current state and the button that starts SwitchServerBandWizard.tsx, which does the whole
 * (abortable) switch - band list, admin proofs and all.
 */
export function WorkspaceHardwareSettings() {
  const { status, refreshing, workspaces, activeWorkspaceName, activeWorkspaceId, reload } = useStageServerStatus()
  const [wizardOpen, setWizardOpen] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">
        {status === 'loading' && 'Lade…'}
        {status === 'unreachable' && 'Stage-Server nicht erreichbar.'}
        {status === 'reachable' && (
          <>
            Aktiv:{' '}
            <span className="font-semibold text-ink">{activeWorkspaceId === null ? 'keine' : (activeWorkspaceName ?? activeWorkspaceId)}</span>
            {refreshing && <span className="text-ink-faint"> · aktualisiere…</span>}
          </>
        )}
      </p>
      <button
        type="button"
        disabled={status !== 'reachable' || !workspaces?.length}
        onClick={() => setWizardOpen(true)}
        className="h-12 rounded-sb bg-control px-4 font-semibold text-ink-soft hover:bg-control-hover disabled:opacity-50"
      >
        Band wechseln…
      </button>

      {wizardOpen && workspaces && (
        <SwitchServerBandWizard
          bands={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onClose={(switched) => {
            setWizardOpen(false)
            if (switched) void reload()
          }}
        />
      )}
    </div>
  )
}
