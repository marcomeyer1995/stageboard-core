import { useState } from 'react'
import { CAPABILITIES } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { triggerShowControl } from '../lib/showControlClient'
import { usePluginsStore } from '../store/usePluginsStore'

/**
 * "More Me" from docs/07: only the musician's own channels plus a band group fader. #3:
 * previously local feedback only - now sends a `set_volume` event per channel to whichever
 * plugin provides `mixer`, same pattern ShowTransportWidget already established. The fader
 * itself still moves immediately on drag (optimistic local update) rather than waiting on a
 * round trip, so it stays responsive even on a slow connection; the plugin call just needs to
 * eventually catch the mixer up to what's shown.
 */
const CHANNELS = ['Mein Gesang', 'Meine Gitarre', 'Band'] as const

export function IemWidget() {
  const installed = usePluginsStore((state) => state.installed)
  const pluginId = pluginProviding(installed, CAPABILITIES.mixer)
  const [levels, setLevels] = useState<Record<string, number>>(() =>
    Object.fromEntries(CHANNELS.map((channel) => [channel, 60])),
  )
  const [error, setError] = useState<string | null>(null)

  async function setVolume(channel: string, volume: number) {
    setLevels((prev) => ({ ...prev, [channel]: volume }))
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, { type: 'set_volume', payload: { channel, volume } })
    setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
  }

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="flex min-h-0 flex-1 gap-4">
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
              onChange={(e) => void setVolume(channel, Number(e.target.value))}
              // Vertical faders: rotating a range input is the only way that stays touch-draggable.
              // Inline style, not Tailwind's own `accent-*` utility: that utility shares our
              // color palette too, so `accent-accent` would be the (confusing) class name.
              style={{ accentColor: 'rgb(var(--sb-accent))' }}
              className="h-full w-2 flex-1 appearance-none rounded-sb-sm bg-control-strong [writing-mode:vertical-lr] [direction:rtl]"
            />
            <span className="font-sb-mono text-sm text-ink">{levels[channel]}</span>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
