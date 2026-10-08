import type { Dashboard } from 'shared-types'
import { canRemoveMode, isDashboardAvailableInMode, toggleDashboardMode } from '../lib/dashboardLayout'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { Button, ChipGroup, Dialog, Section, Segmented, Switch, ToggleChip } from './ui'

/**
 * The dashboard's settings behind ⋯ in the edit bar, built from the shared elements (docs/15):
 * "Anbieten in" = pick several (chips), "Sichtbar für" = pick one (joined bar), Statusleiste and
 * Vorlage = on/off (switch). Everything applies at once, so the way out is one "Fertig".
 */
export function DashboardSettingsDialog({ dashboard, onClose }: { dashboard: Dashboard; onClose: () => void }) {
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
  const lastOfMode = onlyIn.length > 0 ? onlyIn.map((mode) => (mode === 'gig' ? 'Gig' : 'Solo')).join(' und ') : null

  const modeChip = (mode: 'gig' | 'practice', label: string) => {
    const on = isDashboardAvailableInMode(dashboard, mode)
    // The last dashboard of a mode stays offered there.
    const locked = on && !canRemoveMode(dashboards, dashboard, mode)
    return (
      <ToggleChip
        label={label}
        selected={on}
        disabled={locked}
        title={locked ? `Einziges Dashboard für ${label} - bleibt dort` : undefined}
        onToggle={() => void save({ ...dashboard, modes: toggleDashboardMode(dashboard, mode) })}
      />
    )
  }

  return (
    <Dialog title={`Einstellungen: ${dashboard.name}`} onClose={onClose}>
      <Section title="Anbieten in">
        <ChipGroup label="Anbieten in" hint="In diesen Modi steht es im Menü. Mehrere möglich.">
          {modeChip('gig', 'Gig')}
          {modeChip('practice', 'Solo Üben')}
        </ChipGroup>
      </Section>

      <Section title="Sichtbar für" hint={lastPublic ? 'Das einzige geteilte Dashboard bleibt geteilt.' : undefined}>
        <Segmented
          label="Sichtbar für"
          value={dashboard.visibility === 'private' ? 'private' : 'public'}
          onChange={(value) =>
            void save(
              value === 'public'
                ? { ...dashboard, visibility: 'public', ownerProfileId: undefined, ownerRole: undefined }
                : { ...dashboard, visibility: 'private', ownerProfileId: profile?.id, ownerRole: undefined },
            )
          }
          options={[
            { value: 'public', label: 'Ganze Band' },
            { value: 'private', label: 'Nur ich', disabled: dashboard.visibility !== 'private' && (lastPublic || !profile) },
          ]}
        />
      </Section>

      <Section title="Anzeige">
        <Switch label="Statusleiste anzeigen" checked={dashboard.statusBar !== false} onChange={(on) => void save({ ...dashboard, statusBar: on ? undefined : false })} />
        {isAdmin && (
          <Switch
            label="Als Vorlage schützen"
            description="Nur Admins ändern es, alle können es duplizieren."
            checked={dashboard.isReadOnly === true}
            onChange={(on) => void save({ ...dashboard, isReadOnly: on ? true : undefined })}
          />
        )}
      </Section>

      <Section title="Aktionen">
        <Button
          fullWidth
          onClick={async () => {
            const copy = await duplicate(dashboard.id, `${dashboard.name} Kopie`)
            if (copy) setActive(workspaceId, copy.id)
            onClose()
          }}
        >
          Duplizieren
        </Button>
        <Button
          variant="danger"
          fullWidth
          disabled={lastPublic || lastOfMode !== null}
          title={lastPublic ? 'Das einzige geteilte Dashboard bleibt bestehen' : lastOfMode ? `Einziges Dashboard für ${lastOfMode} - bleibt` : undefined}
          onClick={async () => {
            if (!(await confirm(`„${dashboard.name}“ löschen?`, { confirmLabel: 'Löschen', danger: true }))) return
            await remove(dashboard.id)
            setEditing(false)
            onClose()
          }}
        >
          Dashboard löschen
        </Button>
        <Button
          variant="danger"
          fullWidth
          onClick={async () => {
            if (!(await confirm('Alle Dashboards verwerfen und zurücksetzen?', { confirmLabel: 'Zurücksetzen', danger: true }))) return
            void resetToDefaults()
            onClose()
          }}
        >
          Alle Dashboards zurücksetzen
        </Button>
      </Section>
    </Dialog>
  )
}
