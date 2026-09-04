import { useState } from 'react'
import { CAPABILITIES } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { resolveDeviceClaimEngine } from '../lib/deviceClaimEngine'
import { triggerDeviceControl } from '../lib/deviceControlClient'
import { triggerShowControl } from '../lib/showControlClient'
import { useLocalMixerStore } from '../store/useLocalMixerStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * "More Me" from docs/07: only the musician's own channels plus a band group fader. #3:
 * previously local feedback only - now sends a `set_volume` event per channel to whichever
 * plugin provides `mixer`, same pattern ShowTransportWidget already established. The fader
 * itself still moves immediately on drag (optimistic local update) rather than waiting on a
 * round trip, so it stays responsive even on a slow connection; the plugin call just needs to
 * eventually catch the mixer up to what's shown.
 *
 * #10 (generalized beyond audio): a device claimed for `mixer` takes over here instead of the
 * plugin - levels are then sourced from useLocalMixerStore (shared, so every tablet - including
 * the claimed one itself - sees the same fader position) rather than this component's own
 * optimistic local state, since a different tablet's drag is otherwise invisible here.
 */
const CHANNELS = ['Mein Gesang', 'Meine Gitarre', 'Band'] as const

export function IemWidget() {
  const installed = usePluginsStore((state) => state.installed)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const claimedDeviceId = useShowStateStore((state) => state.state.deviceClaims[CAPABILITIES.mixer])
  const pluginId = claimedDeviceId === undefined ? pluginProviding(installed, CAPABILITIES.mixer) : null
  const engine = resolveDeviceClaimEngine(claimedDeviceId, deviceId, pluginId)
  const usesLocalMixerStore = engine === 'local-mine' || engine === 'local-other'
  const localVolumes = useLocalMixerStore((state) => state.volumes)
  const [ownLevels, setOwnLevels] = useState<Record<string, number>>(() =>
    Object.fromEntries(CHANNELS.map((channel) => [channel, 60])),
  )
  const [error, setError] = useState<string | null>(null)

  async function setVolume(channel: string, volume: number) {
    if (usesLocalMixerStore) {
      if (engine === 'local-mine') {
        useLocalMixerStore.getState().applyEvent({ type: 'set_volume', payload: { channel, volume } })
        return
      }
      const result = await triggerDeviceControl(workspaceId, claimedDeviceId!, CAPABILITIES.mixer, {
        type: 'set_volume',
        payload: { channel, volume },
      })
      setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
      return
    }
    setOwnLevels((prev) => ({ ...prev, [channel]: volume }))
    if (!pluginId) return
    const result = await triggerShowControl(pluginId, { type: 'set_volume', payload: { channel, volume } })
    setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
  }

  const levels = usesLocalMixerStore ? { ...ownLevels, ...localVolumes } : ownLevels

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
