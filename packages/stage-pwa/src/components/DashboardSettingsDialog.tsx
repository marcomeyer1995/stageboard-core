import type { Dashboard } from 'shared-types'
import { canRemoveMode, isDashboardAvailableInMode, toggleDashboardMode } from '../lib/dashboardLayout'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Button, ChipGroup, Dialog, Section, Segmented, Switch, ToggleChip } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * The dashboard's settings behind ⋯ in the edit bar, built from the shared elements (docs/15):
 * "Anbieten in" = pick several (chips), "Sichtbar für" = pick one (joined bar), Statusleiste and
 * Vorlage = on/off (switch). Everything applies at once, so the way out is one "Fertig".
 */
export function DashboardSettingsDialog({ dashboard, onClose }: { dashboard: Dashboard; onClose: () => void }) {
  const { t } = useTranslation('dashboard')
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const save = useDashboardsStore((state) => state.save)
  const duplicate = useDashboardsStore((state) => state.duplicate)
  const remove = useDashboardsStore((state) => state.remove)
  const resetToDefaults = useDashboardsStore((state) => state.resetToDefaults)
  const setActive = useActiveDashboardStore((state) => state.setActive)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setEditing = useEditModeStore((state) => state.setEditing)
  const confirm = useDialogStore((state) => state.confirm)
  const profile = useActiveProfile()
  const isAdmin = profile?.stageRoles.includes('admin') ?? false
  // The band keeps at least one shared dashboard.
  const lastPublic = dashboard.visibility !== 'private' && dashboards.filter((d) => d.visibility !== 'private').length <= 1
  // Like the mode chips below: a mode keeps at least one dashboard - deleting must not take it (#422 review).
  const onlyIn = (['gig', 'practice'] as const).filter((mode) => isDashboardAvailableInMode(dashboard, mode) && !canRemoveMode(dashboards, dashboard, mode))
  const lastOfMode = onlyIn.length > 0 ? onlyIn.map((mode) => (mode === 'gig' ? t('gig') : t('solo'))).join(t('and')) : null

  const modeChip = (mode: 'gig' | 'practice', label: string) => {
    const on = isDashboardAvailableInMode(dashboard, mode)
    // The last dashboard of a mode stays offered there.
    const locked = on && !canRemoveMode(dashboards, dashboard, mode)
    return (
      <ToggleChip
        label={label}
        selected={on}
        disabled={locked}
        title={locked ? t('onlyFor', { label }) : undefined}
        onToggle={() => void save({ ...dashboard, modes: toggleDashboardMode(dashboard, mode) })}
      />
    )
  }

  return (
    <Dialog title={t('settingsTitle', { name: dashboard.name })} onClose={onClose}>
      <Section title={t('offerIn')}>
        <ChipGroup label={t('offerIn')} hint={t('offerHint')}>
          {modeChip('gig', t('gig'))}
          {modeChip('practice', t('practice'))}
        </ChipGroup>
      </Section>

      <Section title={t('visibleFor')} hint={lastPublic ? t('lastShared') : undefined}>
        <Segmented
          label={t('visibleFor')}
          value={dashboard.visibility === 'private' ? 'private' : 'public'}
          onChange={(value) =>
            void save(
              value === 'public'
                ? { ...dashboard, visibility: 'public', ownerProfileId: undefined, ownerRole: undefined }
                : { ...dashboard, visibility: 'private', ownerProfileId: profile?.id, ownerRole: undefined },
            )
          }
          options={[
            { value: 'public', label: t('wholeBand') },
            { value: 'private', label: t('onlyMe'), disabled: dashboard.visibility !== 'private' && (lastPublic || !profile) },
          ]}
        />
      </Section>

      <Section title={t('display')}>
        <Switch label={t('showStatusBar')} checked={dashboard.statusBar !== false} onChange={(on) => void save({ ...dashboard, statusBar: on ? undefined : false })} />
        {isAdmin && (
          <Switch
            label={t('protect')}
            description={t('protectHint')}
            checked={dashboard.isReadOnly === true}
            onChange={(on) => void save({ ...dashboard, isReadOnly: on ? true : undefined })}
          />
        )}
      </Section>

      <Section title={t('actions')}>
        <Button
          fullWidth
          onClick={async () => {
            const copy = await duplicate(dashboard.id, t('copyName', { name: dashboard.name }))
            if (copy) setActive(workspaceId, copy.id)
            onClose()
          }}
        >
          {t('duplicate')}
        </Button>
        <Button
          variant="danger"
          fullWidth
          disabled={lastPublic || lastOfMode !== null}
          title={lastPublic ? t('lastSharedStays') : lastOfMode ? t('onlyForShort', { label: lastOfMode }) : undefined}
          onClick={async () => {
            if (!(await confirm(t('deleteAsk', { name: dashboard.name }), { confirmLabel: t('delete'), danger: true }))) return
            await remove(dashboard.id)
            setEditing(false)
            onClose()
          }}
        >
          {t('deleteDashboard')}
        </Button>
        {/* Throws away the whole band's dashboards, templates included - band admins only
            (Marco, 2026-10-08). */}
        {isAdmin && (
          <Button
            variant="danger"
            fullWidth
            onClick={async () => {
              // Says exactly what goes (Marco, 2026-10-08): every dashboard of the band, also the
              // private ones of other members and the templates - for every device, no undo.
              const others = dashboards.filter((d) => d.visibility === 'private' && d.ownerProfileId !== profile?.id).length
              const message = t('resetMsg', { count: dashboards.length, others: others > 0 ? t('resetOthers', { count: others }) : '' })
              if (!(await confirm(message, { title: t('resetTitle'), confirmLabel: t('resetConfirm'), danger: true }))) return
              void resetToDefaults()
              onClose()
            }}
          >
            {t('resetButton')}
          </Button>
        )}
      </Section>
    </Dialog>
  )
}
