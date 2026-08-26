import { useState } from 'react'
import type { CapabilityId, Dashboard } from 'shared-types'
import type { CapabilityStatus } from '../lib/capabilities'
import { isDashboardVisible } from '../lib/dashboardLayout'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { WidgetLibrary } from './WidgetLibrary'

interface DashboardEditBarProps {
  dashboard: Dashboard
  capabilities: Map<CapabilityId, CapabilityStatus>
}

export function DashboardEditBar({ dashboard, capabilities }: DashboardEditBarProps) {
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const save = useDashboardsStore((state) => state.save)
  const create = useDashboardsStore((state) => state.create)
  const duplicate = useDashboardsStore((state) => state.duplicate)
  const rename = useDashboardsStore((state) => state.rename)
  const remove = useDashboardsStore((state) => state.remove)
  const resetToDefaults = useDashboardsStore((state) => state.resetToDefaults)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActive = useActiveDashboardStore((state) => state.setActive)
  const setEditing = useEditModeStore((state) => state.setEditing)
  const [showLibrary, setShowLibrary] = useState(false)
  const activeProfile = useActiveProfile()
  const visibleDashboards = dashboards.filter((item) => isDashboardVisible(item, activeProfile))
  const publicDashboardCount = dashboards.filter((item) => item.visibility !== 'private').length
  const isLastPublicDashboard = dashboard.visibility !== 'private' && publicDashboardCount <= 1

  return (
    <div className="z-20 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2 text-xs">
      <span className="font-bold uppercase tracking-widest text-accent">Edit</span>

      <select
        className="rounded-sb-sm bg-control px-2 py-1 text-ink"
        value={dashboard.id}
        onChange={(e) => setActive(workspaceId, e.target.value)}
      >
        {visibleDashboards.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => setShowLibrary(!showLibrary)}
        className="rounded-sb-sm bg-accent-2 px-3 py-1 font-bold text-accent-ink hover:bg-accent-2-hover"
      >
        + Widget
      </button>

      <button
        type="button"
        onClick={async () => {
          const name = window.prompt('Name des neuen Dashboards?')
          if (!name?.trim()) return
          const created = await create(name.trim())
          setActive(workspaceId, created.id)
        }}
        className="rounded-sb-sm bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover"
      >
        + Dashboard
      </button>

      <button
        type="button"
        onClick={async () => {
          const copy = await duplicate(dashboard.id, `${dashboard.name} Kopie`)
          if (copy) setActive(workspaceId, copy.id)
        }}
        className="rounded-sb-sm bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover"
      >
        Duplizieren
      </button>

      <button
        type="button"
        onClick={() => {
          const name = window.prompt('Neuer Name?', dashboard.name)
          if (name?.trim()) void rename(dashboard.id, name.trim())
        }}
        className="rounded-sb-sm bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover"
      >
        Umbenennen
      </button>

      <button
        type="button"
        disabled={isLastPublicDashboard}
        title={
          isLastPublicDashboard ? 'Das letzte öffentliche Dashboard bleibt bestehen' : undefined
        }
        onClick={() => {
          if (window.confirm(`"${dashboard.name}" löschen?`)) void remove(dashboard.id)
        }}
        className="rounded-sb-sm bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover disabled:opacity-40"
      >
        Löschen
      </button>

      <button
        type="button"
        title="Alle Dashboards verwerfen und die Standard-Layouts neu anlegen"
        onClick={() => {
          if (window.confirm('Alle Dashboards verwerfen und zurücksetzen?')) {
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
          activeRole={activeProfile?.role}
          onAdd={(next) => {
            void save(next)
            setShowLibrary(false)
          }}
        />
      )}
    </div>
  )
}
