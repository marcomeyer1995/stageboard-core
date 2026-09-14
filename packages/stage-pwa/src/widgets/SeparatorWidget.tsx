import type { SeparatorConfig } from './separatorConfig'
import { WIDGET_COLORS, WIDGET_COLOR_LINE } from './widgetColors'

/** A purely visual divider to section off dashboard areas (#23) - no content, no interaction. */
export function SeparatorWidget({ config }: { config: SeparatorConfig }) {
  const lineClass = WIDGET_COLOR_LINE[config.color]
  return (
    <div className="flex h-full w-full items-center justify-center">
      {config.orientation === 'horizontal' ? (
        <div className={`h-px w-full ${lineClass}`} />
      ) : (
        <div className={`h-full w-px ${lineClass}`} />
      )}
    </div>
  )
}

export function SeparatorConfigPanel({
  config,
  onChange,
}: {
  config: SeparatorConfig
  onChange: (next: SeparatorConfig) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Ausrichtung
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.orientation}
          onChange={(e) =>
            onChange({ ...config, orientation: e.target.value as SeparatorConfig['orientation'] })
          }
        >
          <option value="horizontal">Horizontal</option>
          <option value="vertical">Vertikal</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Farbe
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.color}
          onChange={(e) => onChange({ ...config, color: e.target.value as SeparatorConfig['color'] })}
        >
          {WIDGET_COLORS.map((color) => (
            <option key={color} value={color}>
              {color}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
