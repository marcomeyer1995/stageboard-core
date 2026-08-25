import type { DashboardSwitcherConfig } from './dashboardSwitcherConfig'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Switching between dashboards is itself a widget, so each screen decides where the
 * navigation sits. Fat buttons per docs/07 - hit-able mid-song, without looking.
 */
export function DashboardSwitcherView({ config }: { config: DashboardSwitcherConfig }) {
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const byWorkspace = useActiveDashboardStore((state) => state.byWorkspace)
  const setActive = useActiveDashboardStore((state) => state.setActive)

  const visible = config.dashboardIds
    ? config.dashboardIds
        .map((id) => dashboards.find((dashboard) => dashboard.id === id))
        .filter((dashboard) => dashboard !== undefined)
    : dashboards
  const activeId = byWorkspace[workspaceId] ?? dashboards[0]?.id

  return (
    <div
      className={`flex h-full w-full gap-2 ${
        config.orientation === 'vertical' ? 'flex-col' : 'flex-row'
      }`}
    >
      {visible.map((dashboard) => (
        <button
          key={dashboard.id}
          type="button"
          onClick={() => setActive(workspaceId, dashboard.id)}
          className={`flex-1 rounded-lg px-4 text-base font-bold uppercase tracking-wide transition-colors ${
            dashboard.id === activeId
              ? 'bg-amber-500 text-black'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          {dashboard.name}
        </button>
      ))}
    </div>
  )
}

export function DashboardSwitcherConfigPanel({
  config,
  onChange,
}: {
  config: DashboardSwitcherConfig
  onChange: (next: DashboardSwitcherConfig) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-muted">
      Ausrichtung
      <select
        className="rounded bg-control px-2 py-1 text-sm text-ink"
        value={config.orientation}
        onChange={(e) =>
          onChange({ ...config, orientation: e.target.value as DashboardSwitcherConfig['orientation'] })
        }
      >
        <option value="horizontal">Horizontal (Leiste)</option>
        <option value="vertical">Vertikal (Spalte)</option>
      </select>
    </label>
  )
}
