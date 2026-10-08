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
import { WidgetLibrary } from './WidgetLibrary'
import { Icon } from './Icon'
import { Button, IconButton } from './ui'
import { CONTROL, FOCUS, HOVER } from './ui/styles'
import { DashboardSettingsDialog } from './DashboardSettingsDialog'

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
  const setEditing = useEditModeStore((state) => state.setEditing)
  const promptText = useDialogStore((state) => state.promptText)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const activeProfile = useActiveProfile()

  async function rename() {
    const name = (await promptText('Dashboard umbenennen', { label: 'Name', defaultValue: dashboard.name, submitLabel: 'Übernehmen' }))?.trim()
    if (name && name !== dashboard.name) void save({ ...dashboard, name })
  }

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
        className={`flex h-form min-w-0 flex-1 items-center gap-2 px-2 text-left text-lg font-semibold text-ink ${CONTROL} ${FOCUS} ${HOVER}`}
      >
        <span className="truncate">{dashboard.name}</span>
        <Icon name="note" size="1rem" className="text-ink-faint" />
      </button>

      <Button variant="primary" icon="add" onClick={() => setShowLibrary(true)} className="flex-shrink-0 !px-3">
        Widget
      </Button>

      {/* Wide like "+ Widget" (Marco: the small ⋯ was hard to hit). */}
      <IconButton icon="more" label="Dashboard-Einstellungen" onClick={() => setShowSettings(true)} className="!w-16 flex-shrink-0" />

      <Button icon="locked" aria-label="Bearbeiten beenden" onClick={() => setEditing(false)} className="flex-shrink-0 !px-3">
        <span className="hidden sm:inline">Fertig</span>
      </Button>

      {showSettings && <DashboardSettingsDialog dashboard={dashboard} onClose={() => setShowSettings(false)} />}

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
