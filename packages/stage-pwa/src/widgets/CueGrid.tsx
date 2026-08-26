import { useState } from 'react'

/**
 * Shared by QuickActionsWidget and LightingCuesWidget - a grid of big buttons for ad-hoc
 * cues (docs/07 / docs/08 Use Case 4.5). Wired to local feedback only until there is a
 * low-latency cue channel to the Stage-Server; the point of these widgets existing is
 * that they only appear when a matching show-control plugin does.
 */
export function CueGrid({ actions }: { actions: readonly string[] }) {
  const [lastFired, setLastFired] = useState<string | null>(null)

  return (
    <div className="grid h-full w-full grid-cols-2 gap-2">
      {actions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => setLastFired(action)}
          className={`rounded-sb text-sm font-bold uppercase tracking-wide transition-colors ${
            lastFired === action
              ? 'bg-accent text-accent-ink'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          {action}
        </button>
      ))}
    </div>
  )
}
