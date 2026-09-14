import { useState } from 'react'
import { useAutoFitFontSize } from '../lib/useAutoFitFontSize'

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
 */
export function CueGrid({ actions, onFire }: { actions: readonly CueAction[]; onFire: (type: string) => void }) {
  const [lastFired, setLastFired] = useState<string | null>(null)
  // Every button shares one font size, fit to whichever cell has the longest label - each
  // grid cell is an equal-size column, so the widest label is the binding constraint for
  // all of them. Chosen over cq units/discrete tiers after Marco compared all three live
  // (2026-09-14, see the widget-font-autofit memory).
  const [containerRef, textRef, fontSize] = useAutoFitFontSize<HTMLButtonElement, HTMLSpanElement>(
    { min: 10, max: 32 },
    [actions.map((a) => a.label).join('|')],
  )
  const longestType = actions.reduce<CueAction | null>(
    (longest, a) => (longest === null || a.label.length > longest.label.length ? a : longest),
    null,
  )?.type

  return (
    <div className="grid h-full w-full grid-cols-2 gap-2">
      {actions.map((action) => (
        <button
          key={action.type}
          ref={action.type === longestType ? containerRef : undefined}
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
          <span ref={action.type === longestType ? textRef : undefined} style={{ fontSize }} className="whitespace-nowrap">
            {action.label}
          </span>
        </button>
      ))}
    </div>
  )
}
