import { MAX_CONTENT_FONT_SIZE, MIN_CONTENT_FONT_SIZE, useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { Stepper } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * The device-wide default text size for list/scrolling-content widgets (Prompter,
 * Live-Queue, Show-Notizen, System-Status) - a single widget instance can still override it
 * via its own "⋯" menu (ContentFontSizeConfigPanel.tsx).
 *
 * − / + with the value between (Marco, 2026-10-16): the slider changed the size whenever a finger
 * scrolling the page brushed over it.
 */
export function TextSizeSettings() {
  const { t } = useTranslation('system')
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const setBaseFontSize = useContentFontSizeStore((state) => state.setBaseFontSize)

  return (
    <div className="flex flex-col gap-2 text-ink-soft">
      <Stepper label={t('textSize.default')} value={baseFontSize} unit="px" min={MIN_CONTENT_FONT_SIZE} max={MAX_CONTENT_FONT_SIZE} onChange={setBaseFontSize} />
      <p style={{ fontSize: baseFontSize, lineHeight: 1.3 }} className="overflow-x-auto whitespace-nowrap rounded-control bg-control px-2 py-1 font-sb-mono text-ink">
        1. Highway to Hell
      </p>
    </div>
  )
}
