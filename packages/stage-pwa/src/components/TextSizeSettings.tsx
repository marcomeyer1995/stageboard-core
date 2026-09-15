import {
  MAX_CONTENT_FONT_SIZE,
  MIN_CONTENT_FONT_SIZE,
  useContentFontSizeStore,
} from '../store/useContentFontSizeStore'

/**
 * The device-wide default text size for list/scrolling-content widgets (Prompter,
 * Live-Queue, Show-Notizen, System-Status) - a single widget instance can still override it
 * via its own "⋯" menu (ContentFontSizeConfigPanel.tsx).
 */
export function TextSizeSettings() {
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const setBaseFontSize = useContentFontSizeStore((state) => state.setBaseFontSize)

  return (
    <label className="flex flex-col gap-1 text-sm text-ink-soft">
      <div className="flex items-center justify-between">
        <span>Standard-Textgröße</span>
        <span className="text-ink-faint">{baseFontSize}px</span>
      </div>
      <input
        type="range"
        min={MIN_CONTENT_FONT_SIZE}
        max={MAX_CONTENT_FONT_SIZE}
        step={1}
        value={baseFontSize}
        onChange={(e) => setBaseFontSize(Number(e.target.value))}
        className="w-full accent-accent"
      />
      <p
        style={{ fontSize: baseFontSize, lineHeight: 1.3 }}
        className="overflow-x-auto whitespace-nowrap rounded-sb-sm bg-control px-2 py-1 font-sb-mono text-ink"
      >
        1. Highway to Hell
      </p>
      <p className="text-xs text-ink-faint">
        Gilt für Prompter, Live-Queue, Show-Notizen und System-Status - pro Widget im „⋯"-Menü
        überschreibbar.
      </p>
    </label>
  )
}
