import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../components/Icon'
import { useTouchSizes } from '../components/ui/PrepTier'
import { Segmented } from '../components/ui'
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
  const touchSizes = useTouchSizes()
  const { wrap } = switcherLayout(box.height, touchSizes)
  // A bar that scrolls sideways says so (#829, as #373 for the System tabs): "›" while more lies to
  // the right, "‹" once it has moved - the phone hid "Prompter" with nothing to show it was there.
  const stripRef = useRef<HTMLDivElement | null>(null)
  const [more, setMore] = useState({ left: false, right: false })
  const sideways = !vertical && !wrap
  useEffect(() => {
    const strip = stripRef.current
    if (!strip || !sideways) {
      setMore({ left: false, right: false })
      return
    }
    const update = () => setMore({ left: strip.scrollLeft > 2, right: strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2 })
    update()
    strip.addEventListener('scroll', update, { passive: true })
    return () => strip.removeEventListener('scroll', update)
  }, [sideways, box.width, visible.length])
  const hint = 'pointer-events-none absolute inset-y-0 flex w-8 items-center justify-center rounded-control bg-control-strong/90 text-ink'

  return (
    <div className="relative h-full w-full">
      <div
        ref={(node) => {
          boxRef(node)
          stripRef.current = node
        }}
        className={`flex h-full w-full gap-2 ${
          vertical ? 'flex-col overflow-y-auto' : wrap ? 'flex-row flex-wrap overflow-y-auto' : 'flex-row overflow-x-auto'
        }`}
      >
        {visible.map((dashboard) => (
          <button
            key={dashboard.id}
            type="button"
            onClick={() => setActive(workspaceId, dashboard.id)}
            className={`min-h-touch min-w-max flex-1 rounded-control px-4 font-bold uppercase tracking-wide transition-colors ${
              dashboard.id === activeId
                ? 'bg-accent text-accent-ink'
                : 'bg-control-strong text-ink [@media(hover:hover)]:hover:bg-control-strong-hover'
            }`}
          >
            <span style={{ fontSize }} className="whitespace-nowrap">
              {dashboard.name}
            </span>
          </button>
        ))}
      </div>
      {more.left && (
        <span aria-hidden data-more="left" className={`${hint} left-0`}>
          <Icon name="previous" size="1.4em" />
        </span>
      )}
      {more.right && (
        <span aria-hidden data-more="right" className={`${hint} right-0`}>
          <Icon name="next" size="1.4em" />
        </span>
      )}
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
  const { t } = useTranslation('widgets')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-ink-faint">
        {t('switcher.hint')}
      </p>
      <Segmented
        label={t('switcher.orientation')}
        showLabel
        value={config.orientation}
        onChange={(value) => onChange({ ...config, orientation: value as DashboardSwitcherConfig['orientation'] })}
        options={[{ value: 'horizontal', label: t('switcher.horizontal') }, { value: 'vertical', label: t('switcher.vertical') }]}
      />
      <SizeRatioSlider
        label={t('w.size')}
        ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
        onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
      />
    </div>
  )
}
