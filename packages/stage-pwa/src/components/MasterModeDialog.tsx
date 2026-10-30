import i18n from '../i18n'
import type { Workspace } from '../store/useWorkspaceStore'
import { useDialogStore } from '../store/useDialogStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Dialog, Segmented } from './ui'
import { useTranslation } from 'react-i18next'

export const MASTER_MODE_LABEL: Record<'device' | 'account', string> = {
  get device() {
    return i18n.t('band:master.deviceLower')
  },
  get account() {
    return i18n.t('band:master.accountLower')
  },
}

/**
 * How master works in a band (Marco, 2026-10-16: a band setting, so it sits with the band - the
 * badge beside "Aktiv" and the band's ⋯ open this; it used to be a section below the members).
 * Admins of a server-connected band change it; everyone else reads what it means.
 */
export function MasterModeDialog({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const { t } = useTranslation('band')
  const setMasterMode = useWorkspaceStore((state) => state.setMasterMode)
  const alert = useDialogStore((state) => state.alert)
  const canChange = workspace.isAdmin && !!workspace.username
  const mode = workspace.masterMode ?? 'device'

  return (
    <Dialog title={t('master.title', { band: workspace.name })} size="s" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-base text-ink-soft">
          <strong>{t('master.explainDevice')}</strong>
          {t('master.explainDeviceText')}
          <strong>{t('master.explainPerson')}</strong>
          {t('master.explainPersonText')}
        </p>
        {canChange ? (
          <Segmented
            label={t('master.label')}
            value={mode}
            size="stage"
            onChange={async (next) => {
              // Saved on the Stage-Server - say so when that didn't work instead of silently staying (#409 review).
              if (!(await setMasterMode(workspace.id, next))) void alert(t('master.notSaved'))
            }}
            options={[
              { value: 'device', label: t('master.device') },
              { value: 'account', label: t('master.account') },
            ]}
          />
        ) : (
          <p className="text-base text-ink">
            {t('master.thisBand')}
            <strong>{t('master.thisBandMode', { mode: MASTER_MODE_LABEL[mode] })}</strong>
            {t('master.adminsOnly')}
          </p>
        )}
      </div>
    </Dialog>
  )
}
