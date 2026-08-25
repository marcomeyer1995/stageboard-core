import { useState } from 'react'
import type { CapabilityId, Dashboard } from 'shared-types'
import type { CapabilityStatus } from '../lib/capabilities'
import { availableWidgets, withWidgetAppended } from '../lib/dashboardLayout'
import { GRID_COLUMNS } from '../lib/defaultDashboards'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useEditModeStore } from '../store/useEditModeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { ALL_WIDGETS } from '../widgets/registry'

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
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActive = useActiveDashboardStore((state) => state.setActive)
  const setEditing = useEditModeStore((state) => state.setEditing)
  const [showLibrary, setShowLibrary] = useState(false)

  // docs/07: the library only offers what the band's plugins actually support.
  const available = availableWidgets(ALL_WIDGETS, capabilities)

  return (
    <div className="z-20 flex flex-wrap items-center gap-2 border-b border-control bg-surface px-3 py-2 text-xs">
      <span className="font-bold uppercase tracking-widest text-accent">Edit</span>

      <select
        className="rounded bg-control px-2 py-1 text-ink"
        value={dashboard.id}
        onChange={(e) => setActive(workspaceId, e.target.value)}
      >
        {dashboards.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => setShowLibrary(!showLibrary)}
        className="rounded bg-amber-500 px-3 py-1 font-bold text-black hover:bg-amber-400"
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
        className="rounded bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover"
      >
        + Dashboard
      </button>

      <button
        type="button"
        onClick={async () => {
          const copy = await duplicate(dashboard.id, `${dashboard.name} Kopie`)
          if (copy) setActive(workspaceId, copy.id)
        }}
        className="rounded bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover"
      >
        Duplizieren
      </button>

      <button
        type="button"
        onClick={() => {
          const name = window.prompt('Neuer Name?', dashboard.name)
          if (name?.trim()) void rename(dashboard.id, name.trim())
        }}
        className="rounded bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover"
      >
        Umbenennen
      </button>

      <button
        type="button"
        disabled={dashboards.length <= 1}
        title={dashboards.length <= 1 ? 'Das letzte Dashboard bleibt bestehen' : undefined}
        onClick={() => {
          if (window.confirm(`"${dashboard.name}" löschen?`)) void remove(dashboard.id)
        }}
        className="rounded bg-control-strong px-2 py-1 text-ink hover:bg-control-strong-hover disabled:opacity-40"
      >
        Löschen
      </button>

      <button
        type="button"
        onClick={() => setEditing(false)}
        className="ml-auto rounded bg-control px-3 py-1 text-ink-soft hover:bg-control-hover"
      >
        🔒 Fertig
      </button>

      {showLibrary && (
        <div className="flex w-full flex-wrap gap-2 pt-2">
          {available.map((definition) => (
            <button
              key={definition.type}
              type="button"
              title={definition.description}
              onClick={() => {
                void save(
                  withWidgetAppended(
                    dashboard,
                    definition.type,
                    {
                      ...definition.defaultLayout,
                      w: Math.min(definition.defaultLayout.w, GRID_COLUMNS),
                    },
                    `${definition.type}-${crypto.randomUUID().slice(0, 8)}`,
                  ),
                )
                setShowLibrary(false)
              }}
              className="rounded bg-control px-3 py-2 text-left text-ink hover:bg-control-hover"
            >
              <span className="block font-semibold">{definition.title}</span>
              <span className="block text-[10px] text-ink-muted">{definition.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
