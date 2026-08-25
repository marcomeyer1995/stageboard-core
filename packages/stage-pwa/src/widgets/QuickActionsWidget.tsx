import { useState } from 'react'

/**
 * Ad-hoc show cues from docs/07 / docs/08 Use Case 4.5. Like the IEM widget, the buttons
 * are wired to local feedback only until there is a low-latency cue channel to the
 * Stage-Server; the point here is that the widget exists exactly when a show-control
 * plugin does.
 */
const ACTIONS = ['Strobo', 'Blackout', 'Kaltfunken', 'Talkback'] as const

export function QuickActionsWidget() {
  const [lastFired, setLastFired] = useState<string | null>(null)

  return (
    <div className="grid h-full w-full grid-cols-2 gap-2">
      {ACTIONS.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => setLastFired(action)}
          className={`rounded-lg text-sm font-bold uppercase tracking-wide transition-colors ${
            lastFired === action
              ? 'bg-amber-500 text-black'
              : 'bg-control-strong text-ink hover:bg-control-strong-hover'
          }`}
        >
          {action}
        </button>
      ))}
    </div>
  )
}
