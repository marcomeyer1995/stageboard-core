import { useState } from 'react'
import type { CapabilityId, Dashboard } from 'shared-types'
import type { CapabilityStatus } from '../lib/capabilities'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useDialogStore } from '../store/useDialogStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { DashboardManager } from './DashboardManager'
import { WidgetLibrary } from './WidgetLibrary'

interface DashboardEditBarProps {
  dashboard: Dashboard
  capabilities: Map<CapabilityId, CapabilityStatus>
}

export function DashboardEditBar({ dashboard, capabilities }: DashboardEditBarProps) {
  const save = useDashboardsStore((state) => state.save)
  const resetToDefaults = useDashboardsStore((state) => state.resetToDefaults)
  const setEditing = useEditModeStore((state) => state.setEditing)
  const confirm = useDialogStore((state) => state.confirm)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showManager, setShowManager] = useState(false)
  const activeProfile = useActiveProfile()

  return (
    <div className="z-20 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 text-xs">
      <span className="font-bold uppercase tracking-widest text-accent">Edit</span>
      <span className="font-semibold text-ink">{dashboard.name}</span>

      <button
        type="button"
        onClick={() => setShowLibrary(!showLibrary)}
        className="rounded-sb-sm bg-accent-2 px-3 py-1 font-bold text-accent-ink hover:bg-accent-2-hover"
      >
        + Widget
      </button>

      <button
        type="button"
        onClick={() => setShowManager(true)}
        className="rounded-sb-sm bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover"
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
        className="rounded-sb-sm bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover"
      >
        Zurücksetzen
      </button>

      <button
        type="button"
        onClick={() => setEditing(false)}
        className="ml-auto rounded-sb-sm bg-control px-3 py-1 text-ink-soft hover:bg-control-hover"
      >
        🔒 Fertig
      </button>

      {showLibrary && (
        <WidgetLibrary
          dashboard={dashboard}
          capabilities={capabilities}
          activeRoles={activeProfile?.stageRoles}
          onAdd={(next) => {
            void save(next)
            setShowLibrary(false)
          }}
        />
      )}

      {showManager && <DashboardManager onClose={() => setShowManager(false)} />}
    </div>
  )
}
