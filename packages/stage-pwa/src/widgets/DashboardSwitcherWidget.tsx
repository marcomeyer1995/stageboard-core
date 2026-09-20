import { DEFAULT_SIZE_RATIO, type DashboardSwitcherConfig } from './dashboardSwitcherConfig'
import { isDashboardVisible } from '../lib/dashboardLayout'
import { useActiveProfile } from '../lib/useActiveProfile'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { useDashboardsStore } from '../store/useDashboardsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { SizeRatioSlider } from './SizeRatioSlider'

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

  // Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco,
  // 2026-09-14) - every button now shares this same fixed size directly, so the previous
  // "fit to whichever button has the longest name" measurement is gone too.
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO)

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
          className={`flex-1 overflow-hidden rounded-sb px-4 font-bold uppercase tracking-wide transition-colors ${
            dashboard.id === activeId
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          <span style={{ fontSize }} className="whitespace-nowrap">
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
  const dashboards = useDashboardsStore((state) => state.dashboards)
  const activeProfile = useActiveProfile()
  // Same visibility rule as the render logic above: a private Station is never offered here
  // to anyone but its owner.
  const selectable = dashboards.filter((dashboard) => isDashboardVisible(dashboard, activeProfile))
  const pinned = config.dashboardIds
  const showAll = pinned === null

  // Buttons show in pick order, so checking appends and unchecking removes.
  const toggle = (id: string) => {
    const current = pinned ?? []
    onChange({
      ...config,
      dashboardIds: current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-xs text-ink-muted">
        Dashboards
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={showAll}
            // null (not every id) keeps dashboards added later showing up automatically.
            onChange={(e) => onChange({ ...config, dashboardIds: e.target.checked ? null : [] })}
          />
          Alle anzeigen
        </label>
        {!showAll &&
          selectable.map((dashboard) => {
            const position = pinned.indexOf(dashboard.id)
            return (
              <label key={dashboard.id} className="flex items-center gap-2 pl-4 text-sm text-ink">
                <input type="checkbox" checked={position >= 0} onChange={() => toggle(dashboard.id)} />
                {dashboard.name}
                {position >= 0 && <span className="text-xs text-ink-faint">#{position + 1}</span>}
              </label>
            )
          })}
      </div>
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
      <SizeRatioSlider
        label="Größe"
        ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
        onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
      />
    </div>
  )
}
