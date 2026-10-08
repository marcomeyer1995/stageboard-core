import { Segmented, Select } from '../components/ui'
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
      <Segmented
        label="Ausrichtung"
        showLabel
        value={config.orientation}
        onChange={(value) => onChange({ ...config, orientation: value as SeparatorConfig['orientation'] })}
        options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertikal' }]}
      />
      <Select
        label="Farbe"
        value={config.color}
        onChange={(e) => onChange({ ...config, color: e.target.value as SeparatorConfig['color'] })}
        options={WIDGET_COLORS.map((color) => ({ value: color, label: color }))}
      />
    </div>
  )
}
