import { useState } from 'react'
import { useStageServerStatus } from '../lib/useStageServerStatus'
import { SwitchServerBandWizard } from './SwitchServerBandWizard'
import { Button } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * Which band this physical Stage-Server's hardware (plugin sync, Discovery Mode's MIDI watcher)
 * currently serves - never more than one at a time (see workspaceHardwareController.ts on the
 * server; real case: Marco runs one box for two of his own bands, never simultaneously). Just the
 * current state and the button that starts SwitchServerBandWizard.tsx, which does the whole
 * (abortable) switch - band list, admin proofs and all.
 */
export function WorkspaceHardwareSettings() {
  const { t } = useTranslation('system')
  const { status, refreshing, slow, workspaces, activeWorkspaceName, activeWorkspaceId, reload } = useStageServerStatus()
  const [wizardOpen, setWizardOpen] = useState(false)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-muted">
        {status === 'loading' && (slow ? t('hw.slow') : t('hw.loading'))}
        {status === 'unreachable' && t('hw.unreachable')}
        {status === 'unpaired' && t('hw.unpaired')}
        {status === 'reachable' && (
          <>
            {t('hw.active')}
            <span className="font-semibold text-ink">{activeWorkspaceId === null ? t('hw.none') : (activeWorkspaceName ?? activeWorkspaceId)}</span>
            {refreshing && <span className="text-ink-faint"> · {slow ? t('hw.slowShort') : t('hw.refreshing')}</span>}
          </>
        )}
      </p>
      <Button disabled={status !== 'reachable' || !workspaces?.length} onClick={() => setWizardOpen(true)}>
        {t('hw.switch')}
      </Button>

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
