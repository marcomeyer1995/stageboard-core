import { useState } from 'react'
import type { Breakpoint, CapabilityId, Dashboard } from 'shared-types'
import type { CapabilityStatus } from '../lib/capabilities'
import { canRemoveMode, isDashboardAvailableInMode, toggleDashboardMode, withWidgetAppended } from '../lib/dashboardLayout'
import { randomId } from '../lib/id'
import { useActiveProfile } from '../lib/useActiveProfile'
import type { WidgetDefinition } from '../widgets/registry'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { WidgetLibrary } from './WidgetLibrary'
import { Icon } from './Icon'
import { OverflowMenu } from './OverflowMenu'

interface DashboardEditBarProps {
  dashboard: Dashboard
  breakpoint: Breakpoint
  capabilities: Map<CapabilityId, CapabilityStatus>
}

export function DashboardEditBar({ dashboard, breakpoint, capabilities }: DashboardEditBarProps) {
  const save = useDashboardsStore((state) => state.save)
  const create = useDashboardsStore((state) => state.create)
  const setActive = useActiveDashboardStore((state) => state.setActive)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const resetToDefaults = useDashboardsStore((state) => state.resetToDefaults)
  const setEditing = useEditModeStore((state) => state.setEditing)
  const confirm = useDialogStore((state) => state.confirm)
  const promptText = useDialogStore((state) => state.promptText)
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const duplicate = useDashboardsStore((state) => state.duplicate)
  const remove = useDashboardsStore((state) => state.remove)
  const [showLibrary, setShowLibrary] = useState(false)
  const activeProfile = useActiveProfile()
  const isAdmin = activeProfile?.stageRoles.includes('admin') ?? false
  const lastPublic = dashboard.visibility !== 'private' && dashboards.filter((d) => d.visibility !== 'private').length <= 1

  async function rename() {
    const name = (await promptText('Dashboard umbenennen', { label: 'Name', defaultValue: dashboard.name, submitLabel: 'Übernehmen' }))?.trim()
    if (name && name !== dashboard.name) void save({ ...dashboard, name })
  }

  /** Everything besides name, widgets and "Fertig" (Marco: used rarely, so behind ⋯). */
  const settings = [
    ...(['gig', 'practice'] as const).map((mode) => {
      const on = isDashboardAvailableInMode(dashboard, mode)
      return {
        label: `${mode === 'gig' ? 'Gig' : 'Solo Üben'}: ${on ? 'angeboten - ausschalten' : 'nicht angeboten - einschalten'}`,
        // The last dashboard of a mode stays offered there.
        disabled: on && !canRemoveMode(dashboards, dashboard, mode),
        onClick: () => void save({ ...dashboard, modes: toggleDashboardMode(dashboard, mode) }),
      }
    }),
    {
      label: dashboard.statusBar === false ? 'Statusleiste einblenden' : 'Statusleiste ausblenden',
      onClick: () => void save({ ...dashboard, statusBar: dashboard.statusBar === false }),
    },
    dashboard.visibility === 'private'
      ? { label: 'Für die ganze Band teilen', onClick: () => void save({ ...dashboard, visibility: 'public' as const, ownerProfileId: undefined, ownerRole: undefined }) }
      : {
          label: 'Nur für mich (privat)',
          // The band keeps at least one shared dashboard.
          disabled: lastPublic || !activeProfile,
          onClick: () => void save({ ...dashboard, visibility: 'private' as const, ownerProfileId: activeProfile?.id }),
        },
    ...(isAdmin
      ? [
          {
            label: dashboard.isReadOnly ? 'Vorlage freigeben' : 'Als Vorlage schützen (nur Admins ändern)',
            onClick: () => void save({ ...dashboard, isReadOnly: dashboard.isReadOnly ? undefined : true }),
          },
        ]
      : []),
    {
      label: 'Duplizieren',
      onClick: async () => {
        const copy = await duplicate(dashboard.id, `${dashboard.name} Kopie`)
        if (copy) setActive(workspaceId, copy.id)
      },
    },
    {
      label: 'Dashboard löschen',
      danger: true,
      disabled: lastPublic,
      onClick: async () => {
        if (!(await confirm(`„${dashboard.name}“ löschen?`, { confirmLabel: 'Löschen', danger: true }))) return
        await remove(dashboard.id)
        setEditing(false)
      },
    },
    {
      label: 'Alle Dashboards zurücksetzen',
      danger: true,
      onClick: async () => {
        if (await confirm('Alle Dashboards verwerfen und zurücksetzen?', { confirmLabel: 'Zurücksetzen', danger: true })) {
          void resetToDefaults()
        }
      },
    },
  ]

  // The widget library's answer to "no room here": a public dashboard named after the widget,
  // offered in the same modes as the current one (so it shows up right away), with the widget
  // at its full default size - then switch to it, still in edit mode.
  async function addToNewDashboard(definition: WidgetDefinition) {
    const created = await create(definition.title)
    await save(
      withWidgetAppended(
        { ...created, modes: dashboard.modes },
        definition.type,
        definition.defaultLayout,
        `${definition.type}-${randomId().slice(0, 8)}`,
      ),
    )
    setActive(workspaceId, created.id)
    setShowLibrary(false)
  }

  // One row in the status bar's place (#370): its height is fixed (h-14), so nothing wraps. Name,
  // "+ Widget" and "Fertig" are used all the time and always visible; the rest sits behind ⋯
  // (Marco's redesign - replaces "Dashboards verwalten").
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm">
      <span className="hidden flex-shrink-0 font-bold uppercase tracking-widest text-accent sm:inline">Edit</span>
      <button
        type="button"
        onClick={() => void rename()}
        title="Umbenennen"
        className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-sb-sm px-2 text-left text-base font-semibold text-ink hover:bg-control-hover"
      >
        <span className="truncate">{dashboard.name}</span>
        <Icon name="note" size="1rem" className="text-ink-faint" />
      </button>

      <button
        type="button"
        onClick={() => setShowLibrary(true)}
        className="h-12 flex-shrink-0 rounded-sb-sm bg-accent-2 px-3 font-bold text-accent-ink hover:bg-accent-2-hover"
      >
        + Widget
      </button>

      <OverflowMenu title={dashboard.name} actions={settings} />

      <button
        type="button"
        onClick={() => setEditing(false)}
        aria-label="Bearbeiten beenden"
        className="flex h-12 flex-shrink-0 items-center gap-2 rounded-sb-sm bg-control px-3 text-ink-soft hover:bg-control-hover"
      >
        <Icon name="locked" size="1.25rem" />
        <span className="hidden sm:inline">Fertig</span>
      </button>

      {showLibrary && (
        <WidgetLibrary
          dashboard={dashboard}
          breakpoint={breakpoint}
          capabilities={capabilities}
          activeRoles={activeProfile?.stageRoles}
          onAdd={(next) => {
            void save(next)
            setShowLibrary(false)
          }}
          onAddToNewDashboard={(definition) => void addToNewDashboard(definition)}
          onClose={() => setShowLibrary(false)}
        />
      )}

    </div>
  )
}
