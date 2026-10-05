import { useState } from 'react'
import type { Breakpoint, CapabilityId, Dashboard } from 'shared-types'
import type { CapabilityStatus } from '../lib/capabilities'
import { withWidgetAppended } from '../lib/dashboardLayout'
import { randomId } from '../lib/id'
import { useActiveProfile } from '../lib/useActiveProfile'
import type { WidgetDefinition } from '../widgets/registry'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { DashboardManager } from './DashboardManager'
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
  const [showLibrary, setShowLibrary] = useState(false)
  const [showManager, setShowManager] = useState(false)
  const activeProfile = useActiveProfile()

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

  // One row in the status bar's place (#370): its height is fixed (h-14), so nothing wraps -
  // the name shortens, and the rare "Zurücksetzen" sits behind ⋯.
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 px-2 text-sm">
      <span className="flex-shrink-0 font-bold uppercase tracking-widest text-accent">Edit</span>
      {/* On a phone there is no room for the name next to the buttons - the menu shows it. */}
      <span className="hidden min-w-0 flex-1 truncate font-semibold text-ink sm:block">{dashboard.name}</span>
      <span className="flex-1 sm:hidden" />

      <button
        type="button"
        onClick={() => setShowLibrary(true)}
        className="h-touch flex-shrink-0 rounded-sb-sm bg-accent-2 px-3 font-bold text-accent-ink hover:bg-accent-2-hover"
      >
        + Widget
      </button>

      <button
        type="button"
        onClick={() => setShowManager(true)}
        className="h-touch flex-shrink-0 rounded-sb-sm bg-control-strong px-3 text-ink hover:bg-control-strong-hover"
      >
        Dashboards
      </button>

      <OverflowMenu
        title="Bearbeiten"
        triggerSize="touch"
        actions={[
          {
            label: 'Alle Dashboards zurücksetzen',
            danger: true,
            onClick: async () => {
              if (await confirm('Alle Dashboards verwerfen und zurücksetzen?', { confirmLabel: 'Zurücksetzen', danger: true })) {
                void resetToDefaults()
              }
            },
          },
        ]}
      />

      <button
        type="button"
        onClick={() => setEditing(false)}
        aria-label="Bearbeiten beenden"
        className="flex h-touch flex-shrink-0 items-center gap-2 rounded-sb-sm bg-control px-3 text-ink-soft hover:bg-control-hover"
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

      {showManager && <DashboardManager onClose={() => setShowManager(false)} />}
    </div>
  )
}
