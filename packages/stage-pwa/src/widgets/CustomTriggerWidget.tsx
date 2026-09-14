import { useEffect, useState } from 'react'
import type { ShowControlEvent } from 'shared-types'
import { pluginProviding } from '../lib/capabilities'
import { getTranslator, preloadDynamicTranslator, supportsLocalExecution } from '../lib/clientTranslator'
import { triggerDeviceControl } from '../lib/deviceControlClient'
import { resolveHardwareBindingById, resolveHardwareEngine } from '../lib/hardwareRouting'
import { getStageServerUrl } from '../lib/stageServer'
import { triggerShowControl } from '../lib/showControlClient'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { type CustomTriggerConfig } from './customTriggerConfig'
import { WIDGET_COLORS, WIDGET_COLOR_SOLID } from './widgetColors'

const INACTIVE_CLASS = 'bg-control-strong text-ink hover:bg-control-strong-hover'

function parsePayload(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * A configurable trigger button for an arbitrary Logical Device (#23) - latching (toggle,
 * like LightingCuesWidget's blackout) or momentary (fires only while held, like a strobe).
 * Unlike QuickActionsWidget/LightingCuesWidget, the target isn't a fixed capability this
 * widget's `requires` gates on, but a config-picked device (same reasoning DeviceStatusWidget
 * uses) - so firing mirrors cueFiring.ts's engine resolution by hand, plus the `local-other`
 * relay branch cueFiring.ts deliberately omits (that omission is specific to *scheduled* cues,
 * where the other bound device runs its own scheduler independently - an ad-hoc button press
 * has no such independent trigger on the other device, so it must go through the relay).
 */
export function CustomTriggerWidget({ config }: { config: CustomTriggerConfig }) {
  const devices = useLogicalDevicesStore((s) => s.devices)
  const installed = usePluginsStore((s) => s.installed)
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const deviceId = useShowStateStore((s) => s.deviceId)
  const [on, setOn] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [, forceRerender] = useState(0)

  const device = resolveHardwareBindingById(devices, config.targetLogicalDeviceId ?? '')

  useEffect(() => {
    if (!device) return
    let cancelled = false
    void preloadDynamicTranslator(device.capability, installed, getStageServerUrl() ?? null).then(() => {
      if (!cancelled) forceRerender((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [device, installed])

  async function fire(payload: Record<string, unknown>) {
    if (!device) return
    const pluginId = device.pluginId ?? pluginProviding(installed, device.capability)
    const engine = resolveHardwareEngine(
      device,
      deviceId,
      pluginId,
      supportsLocalExecution(installed, device.capability),
    )
    const event: ShowControlEvent = { type: config.commandType, payload }

    if (engine === 'local-mine') {
      const translator = getTranslator(device.capability)
      if (translator) void translator(event)
      return
    }
    if (engine === 'local-other') {
      const result = await triggerDeviceControl(workspaceId, device.executionTarget!, device.capability, event)
      setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
      return
    }
    if (engine === 'plugin' && pluginId) {
      const result = await triggerShowControl(pluginId, event)
      setError(result.status === 'error' ? (result.message ?? 'Fehler') : null)
    }
  }

  const basePayload = parsePayload(config.commandPayloadJson)
  const disabled = !device
  const active = config.behavior === 'latching' ? on : pressed

  function handleLatchingClick() {
    const next = !on
    setOn(next)
    void fire({ ...basePayload, on: next })
  }

  function handleMomentaryDown() {
    setPressed(true)
    void fire({ ...basePayload, active: true })
  }

  function handleMomentaryUp() {
    setPressed(false)
    void fire({ ...basePayload, active: false })
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <button
        type="button"
        disabled={disabled}
        onClick={config.behavior === 'latching' ? handleLatchingClick : undefined}
        onPointerDown={config.behavior === 'momentary' ? handleMomentaryDown : undefined}
        onPointerUp={config.behavior === 'momentary' ? handleMomentaryUp : undefined}
        onPointerLeave={config.behavior === 'momentary' ? handleMomentaryUp : undefined}
        className={`h-full min-h-0 flex-1 rounded-sb text-sm font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          active ? WIDGET_COLOR_SOLID[config.color] : INACTIVE_CLASS
        }`}
      >
        {config.label}
      </button>
      {disabled && <p className="text-xs text-ink-faint">Kein Zielgerät konfiguriert</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

export function CustomTriggerConfigPanel({
  config,
  onChange,
}: {
  config: CustomTriggerConfig
  onChange: (next: CustomTriggerConfig) => void
}) {
  const devices = useLogicalDevicesStore((s) => s.devices)
  const payloadValid = (() => {
    try {
      JSON.parse(config.commandPayloadJson)
      return true
    } catch {
      return false
    }
  })()

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Beschriftung
        <input
          type="text"
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.label}
          onChange={(e) => onChange({ ...config, label: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Farbe
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.color}
          onChange={(e) => onChange({ ...config, color: e.target.value as CustomTriggerConfig['color'] })}
        >
          {WIDGET_COLORS.map((color) => (
            <option key={color} value={color}>
              {color}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Verhalten
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.behavior}
          onChange={(e) => onChange({ ...config, behavior: e.target.value as CustomTriggerConfig['behavior'] })}
        >
          <option value="momentary">Momentary (nur während gehalten)</option>
          <option value="latching">Latching (Umschalten)</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Zielgerät
        <select
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.targetLogicalDeviceId ?? ''}
          onChange={(e) => onChange({ ...config, targetLogicalDeviceId: e.target.value || undefined })}
        >
          <option value="">— Gerät wählen —</option>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Command-Type
        <input
          type="text"
          className="rounded-sb-sm bg-control px-2 py-1 text-sm text-ink"
          value={config.commandType}
          onChange={(e) => onChange({ ...config, commandType: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-ink-muted">
        Payload (JSON)
        <textarea
          className="rounded-sb-sm bg-control px-2 py-1 font-mono text-xs text-ink"
          rows={3}
          value={config.commandPayloadJson}
          onChange={(e) => onChange({ ...config, commandPayloadJson: e.target.value })}
        />
        {!payloadValid && <span className="text-red-500">Ungültiges JSON</span>}
      </label>
    </div>
  )
}
