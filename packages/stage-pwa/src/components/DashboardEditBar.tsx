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

  return (
    <div className="z-20 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 text-xs">
      <span className="font-bold uppercase tracking-widest text-accent">Edit</span>
      <span className="font-semibold text-ink">{dashboard.name}</span>

      <button
        type="button"
        onClick={() => setShowLibrary(true)}
        className="rounded-sb-sm bg-accent-2 h-touch px-4 font-bold text-accent-ink hover:bg-accent-2-hover"
      >
        + Widget
      </button>

      <button
        type="button"
        onClick={() => setShowManager(true)}
        className="rounded-sb-sm bg-control-strong h-touch px-4 text-ink hover:bg-control-strong-hover"
      >
        Dashboards verwalten
      </button>

      <button
        type="button"
        title="Alle Dashboards verwerfen und die Standard-Layouts neu anlegen"
        onClick={async () => {
          if (await confirm('Alle Dashboards verwerfen und zurücksetzen?', { confirmLabel: 'Zurücksetzen', danger: true })) {
            void resetToDefaults()
          }
        }}
        className="rounded-sb-sm bg-control-strong h-touch px-4 text-ink hover:bg-control-strong-hover"
      >
        Zurücksetzen
      </button>

      <button
        type="button"
        onClick={() => setEditing(false)}
        className="ml-auto rounded-sb-sm bg-control h-touch px-4 text-ink-soft hover:bg-control-hover"
      >
        🔒 Fertig
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
