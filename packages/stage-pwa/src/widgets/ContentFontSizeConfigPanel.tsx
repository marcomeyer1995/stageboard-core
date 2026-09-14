import { useDeferredSliderValue } from '../lib/useDeferredSliderValue'
import { MAX_CONTENT_FONT_SIZE, MIN_CONTENT_FONT_SIZE, useContentFontSizeStore } from '../store/useContentFontSizeStore'
import type { ContentFontSizeConfig } from './contentFontSizeConfig'

/** Shared by every list/scrolling-content widget's ConfigPanel (Prompter, Live-Queue,
 * Show-Notizen, System-Status) - override this one instance's text size, or reset it to
 * follow the device-wide default (SystemSettings' "Textgröße"). */
export function ContentFontSizeConfigPanel({
  config,
  onChange,
}: {
  config: ContentFontSizeConfig
  onChange: (next: ContentFontSizeConfig) => void
}) {
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const resolved = config.fontSize ?? baseFontSize
  // Debounced commit (useDeferredSliderValue.ts) - committing straight through on every
  // drag tick round-trips through a real PouchDB write each time, which made this stutter
  // (Marco, 2026-09-14).
  const [value, onDrag, flush] = useDeferredSliderValue(
    resolved,
    (fontSize) => onChange({ ...config, fontSize }),
    'Textgröße',
  )

  return (
    <label className="flex flex-col gap-1 text-xs text-ink-muted">
      <div className="flex items-center justify-between">
        <span>Textgröße{config.fontSize === undefined ? ' (Standard)' : ''}</span>
        <span className="text-ink-faint">{value}px</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={MIN_CONTENT_FONT_SIZE}
          max={MAX_CONTENT_FONT_SIZE}
          step={1}
          value={value}
          onChange={(e) => onDrag(Number(e.target.value))}
          onPointerUp={flush}
          className="w-full accent-accent"
        />
        {config.fontSize !== undefined && (
          <button
            type="button"
            onClick={() => onChange({ ...config, fontSize: undefined })}
            title="Auf Geräte-Standard zurücksetzen"
            className="flex-shrink-0 rounded-sb-sm bg-control px-2 py-1 text-ink-soft hover:bg-control-hover"
          >
            Standard
          </button>
        )}
      </div>
    </label>
  )
}
