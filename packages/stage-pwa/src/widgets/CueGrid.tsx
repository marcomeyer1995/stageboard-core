import { useState } from 'react'
import { DEFAULT_SIZE_RATIO, type CueGridConfig } from './cueGridConfig'
import { SizeRatioSlider } from './SizeRatioSlider'

export interface CueAction {
  /** Shown on the button. */
  label: string
  /** The ShowControlEvent's `type` sent to the plugin - a stable machine identifier,
   * independent of the German display label (#3). */
  type: string
}

/**
 * Shared by QuickActionsWidget and LightingCuesWidget - a grid of big buttons for ad-hoc
 * cues (docs/07 / docs/08 Use Case 4.5). Purely the grid/button chrome and "which one did I
 * just press" visual feedback; each caller supplies its own `onFire` wired to whichever
 * capability's plugin it needs (#3) - CueGrid itself doesn't know or care what a press does.
 *
 * `fontSize` is computed by the caller from its own config (a ratio of the device-wide
 * default, not auto-fit to the tile - Marco, 2026-09-14) - every button just renders at that
 * one fixed size now, so there's no more "fit to whichever cell has the longest label"
 * measurement.
 */
export function CueGrid({
  actions,
  onFire,
  fontSize,
}: {
  actions: readonly CueAction[]
  onFire: (type: string) => void
  fontSize: number
}) {
  const [lastFired, setLastFired] = useState<string | null>(null)

  return (
    <div className="grid h-full w-full grid-cols-2 gap-2">
      {actions.map((action) => (
        <button
          key={action.type}
          type="button"
          onClick={() => {
            setLastFired(action.type)
            onFire(action.type)
          }}
          className={`overflow-hidden rounded-sb font-bold uppercase tracking-wide transition-colors ${
            lastFired === action.type
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          <span style={{ fontSize }} className="whitespace-nowrap">
            {action.label}
          </span>
        </button>
      ))}
    </div>
  )
}

/** Shared by QuickActionsWidget and LightingCuesWidget - identical config shape, so one
 * component covers both rather than duplicating it. */
export function CueGridConfigPanel({
  config,
  onChange,
}: {
  config: CueGridConfig
  onChange: (next: CueGridConfig) => void
}) {
  return (
    <SizeRatioSlider
      label="Größe"
      ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
      onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
    />
  )
}
