import { MAX_CONTENT_FONT_SIZE, MIN_CONTENT_FONT_SIZE, useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { IconButton } from './ui'

/**
 * The device-wide default text size for list/scrolling-content widgets (Prompter,
 * Live-Queue, Show-Notizen, System-Status) - a single widget instance can still override it
 * via its own "⋯" menu (ContentFontSizeConfigPanel.tsx).
 *
 * − / + with the value between (Marco, 2026-10-16): the slider changed the size whenever a finger
 * scrolling the page brushed over it.
 */
export function TextSizeSettings() {
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const setBaseFontSize = useContentFontSizeStore((state) => state.setBaseFontSize)
  const change = (by: number) => setBaseFontSize(Math.min(MAX_CONTENT_FONT_SIZE, Math.max(MIN_CONTENT_FONT_SIZE, baseFontSize + by)))

  return (
    <div className="flex flex-col gap-2 text-ink-soft">
      <div className="flex items-center justify-between gap-3">
        <span id="text-size-label">Standard-Textgröße</span>
        <div className="flex items-center gap-2" role="group" aria-labelledby="text-size-label">
          <IconButton icon="decrease" label="Kleiner" onClick={() => change(-1)} disabled={baseFontSize <= MIN_CONTENT_FONT_SIZE} />
          <output className="min-w-[4.5rem] text-center text-lg font-semibold text-ink" aria-live="polite">
            {baseFontSize} px
          </output>
          <IconButton icon="increase" label="Größer" onClick={() => change(1)} disabled={baseFontSize >= MAX_CONTENT_FONT_SIZE} />
        </div>
      </div>
      <p style={{ fontSize: baseFontSize, lineHeight: 1.3 }} className="overflow-x-auto whitespace-nowrap rounded-control bg-control px-2 py-1 font-sb-mono text-ink">
        1. Highway to Hell
      </p>
      <p className="text-sm text-ink-faint">Gilt für Prompter, Live-Queue, Show-Notizen und System-Status - pro Widget im „⋯"-Menü überschreibbar.</p>
    </div>
  )
}
