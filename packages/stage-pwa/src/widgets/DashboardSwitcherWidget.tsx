import { DEFAULT_SIZE_RATIO, type DashboardSwitcherConfig } from './dashboardSwitcherConfig'
import { useActiveDashboardStore } from '../store/useActiveDashboardStore'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { SizeRatioSlider } from './SizeRatioSlider'
import { stageFontSize } from '../lib/stageSize'
import { switcherLayout } from '../lib/stageWidgetLayout'
import { useElementSize } from '../lib/useElementSize'
import { useModeDashboards } from '../lib/useModeDashboards'

/**
 * Switching between dashboards is itself a widget, so each screen decides where the
 * navigation sits. Fat buttons per docs/07 - hit-able mid-song, without looking.
 *
 * Every button is at least as wide as its name - names were cut to "Monitori" when nine
 * dashboards shared a 12-column bar (GUI audit 2026-09-27). What doesn't fit wraps onto another
 * row when the widget is tall enough for two, otherwise the bar scrolls sideways
 * (stageWidgetLayout.ts); a vertical switcher scrolls down.
 */
export function DashboardSwitcherView({ config }: { config: DashboardSwitcherConfig }) {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const setActive = useActiveDashboardStore((state) => state.setActive)

  // Exactly the burger menu's list on this device (Marco): visible to this person, offered in the
  // current session mode, in this device's order, without the ones hidden here. No selection of
  // its own any more - a band-wide pick could point at dashboards another person can't see (an
  // empty switcher for them) or that the current mode doesn't offer.
  const { candidates: visible, active } = useModeDashboards()
  const activeId = active?.id

  // Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco,
  // 2026-09-14) - every button now shares this same fixed size directly, so the previous
  // "fit to whichever button has the longest name" measurement is gone too.
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))
  const [boxRef, box] = useElementSize()
  const vertical = config.orientation === 'vertical'
  const { wrap } = switcherLayout(box.height)

  return (
    <div
      ref={boxRef}
      className={`flex h-full w-full gap-2 ${
        vertical ? 'flex-col overflow-y-auto' : wrap ? 'flex-row flex-wrap overflow-y-auto' : 'flex-row overflow-x-auto'
      }`}
    >
      {visible.map((dashboard) => (
        <button
          key={dashboard.id}
          type="button"
          onClick={() => setActive(workspaceId, dashboard.id)}
          className={`min-h-touch min-w-max flex-1 rounded-sb px-4 font-bold uppercase tracking-wide transition-colors ${
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
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-faint">
        Zeigt dieselben Dashboards wie das Menü: ausblenden und sortieren unter ☰ → Dashboards → „Ordnen“, Gig/Solo in den
        Einstellungen des Dashboards.
      </p>
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
