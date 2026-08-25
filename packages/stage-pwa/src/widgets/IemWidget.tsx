import { useState } from 'react'

/**
 * "More Me" from docs/07: only the musician's own channels plus a band group fader.
 * The faders move local state for now - sending the values to a mixer needs a
 * low-latency channel to the Stage-Server (docs/01 names OSC/WebSocket), which is
 * deliberately not part of the plugin-aware UI step. Without a mixer plugin the whole
 * widget sits in the Disabled State anyway.
 */
const CHANNELS = ['Mein Gesang', 'Meine Gitarre', 'Band'] as const

export function IemWidget() {
  const [levels, setLevels] = useState<Record<string, number>>(() =>
    Object.fromEntries(CHANNELS.map((channel) => [channel, 60])),
  )

  return (
    <div className="flex h-full w-full gap-4">
      {CHANNELS.map((channel) => (
        <div key={channel} className="flex flex-1 flex-col items-center gap-2">
          <span className="text-center text-xs uppercase tracking-wide text-ink-muted">
            {channel}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={levels[channel]}
            onChange={(e) => setLevels({ ...levels, [channel]: Number(e.target.value) })}
            // Vertical faders: rotating a range input is the only way that stays touch-draggable.
            className="h-full w-2 flex-1 appearance-none rounded bg-control-strong accent-amber-500 [writing-mode:vertical-lr] [direction:rtl]"
          />
          <span className="font-mono text-sm text-ink">{levels[channel]}</span>
        </div>
      ))}
    </div>
  )
}
