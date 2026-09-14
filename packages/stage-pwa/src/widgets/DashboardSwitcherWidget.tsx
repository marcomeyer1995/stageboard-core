import type { DashboardSwitcherConfig } from './dashboardSwitcherConfig'
import { isDashboardVisible } from '../lib/dashboardLayout'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useAutoFitFontSize } from '../lib/useAutoFitFontSize'
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
  const activeProfile = useActiveProfile()

  // A private Station never appears as a switch target for anyone but its owner, whether
  // it was picked explicitly in this instance's config or just fell out of "show all."
  const selectable = dashboards.filter((dashboard) => isDashboardVisible(dashboard, activeProfile))
  const visible = config.dashboardIds
    ? config.dashboardIds
        .map((id) => selectable.find((dashboard) => dashboard.id === id))
        .filter((dashboard) => dashboard !== undefined)
    : selectable
  const activeId = byWorkspace[workspaceId] ?? selectable[0]?.id

  // All buttons share one font size, fit to whichever one has the longest name - chosen
  // over cq units/discrete tiers after Marco compared all three live (2026-09-14, see the
  // widget-font-autofit memory).
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLButtonElement, HTMLSpanElement>(
    { min: 10, max: 40 },
    [visible.map((d) => d.name).join('|'), config.orientation],
  )
  const longestId = visible.reduce<{ id: string; length: number } | null>(
    (longest, d) => (longest === null || d.name.length > longest.length ? { id: d.id, length: d.name.length } : longest),
    null,
  )?.id

  return (
    <div
      className={`flex h-full w-full gap-2 ${
        config.orientation === 'vertical' ? 'flex-col' : 'flex-row'
      }`}
    >
      {visible.map((dashboard) => (
        <button
          key={dashboard.id}
          ref={dashboard.id === longestId ? containerRef : undefined}
          type="button"
          onClick={() => setActive(workspaceId, dashboard.id)}
          className={`flex-1 overflow-hidden rounded-sb px-4 font-bold uppercase tracking-wide transition-colors ${
            dashboard.id === activeId
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          <span ref={dashboard.id === longestId ? textRef : undefined} style={{ fontSize }} className="whitespace-nowrap">
            {dashboard.name}
          </span>
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
        className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
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
