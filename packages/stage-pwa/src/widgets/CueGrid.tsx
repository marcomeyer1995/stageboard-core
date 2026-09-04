import { useState } from 'react'

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
          className={`rounded-sb text-sm font-bold uppercase tracking-wide transition-colors ${
            lastFired === action.type
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
