import { Field, Segmented, Select, TextArea } from '../components/ui'
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
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { DEFAULT_SIZE_RATIO, type CustomTriggerConfig } from './customTriggerConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { WIDGET_COLORS, WIDGET_COLOR_SOLID } from './widgetColors'
import { stageFontSize } from '../lib/stageSize'

const INACTIVE_CLASS = 'bg-control-strong text-ink [@media(hover:hover)]:hover:bg-control-strong-hover'

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
  // Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco,
  // 2026-09-14).
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

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
    const event: ShowControlEvent = { type: config.commandType, payload, ...(device ? { logicalDeviceId: device.id } : {}) }

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
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <button
        type="button"
        disabled={disabled}
        onClick={config.behavior === 'latching' ? handleLatchingClick : undefined}
        onPointerDown={config.behavior === 'momentary' ? handleMomentaryDown : undefined}
        onPointerUp={config.behavior === 'momentary' ? handleMomentaryUp : undefined}
        onPointerLeave={config.behavior === 'momentary' ? handleMomentaryUp : undefined}
        className={`flex h-full min-h-touch flex-1 items-center justify-center overflow-hidden rounded-control font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          active ? WIDGET_COLOR_SOLID[config.color] : INACTIVE_CLASS
        }`}
      >
        <span style={{ fontSize }} className="whitespace-nowrap">
          {config.label}
        </span>
      </button>
      {/* One line each: the button keeps its touch height, the hint gives way. */}
      {disabled && <p className="flex-shrink-0 truncate text-xs text-ink-faint">Kein Zielgerät konfiguriert</p>}
      {error && <p className="flex-shrink-0 truncate text-xs text-red-500">{error}</p>}
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
    <div className="flex flex-col gap-3">
      <Field label="Beschriftung" value={config.label} onChange={(e) => onChange({ ...config, label: e.target.value })} />
      <Select
        label="Farbe"
        value={config.color}
        onChange={(e) => onChange({ ...config, color: e.target.value as CustomTriggerConfig['color'] })}
        options={WIDGET_COLORS.map((color) => ({ value: color, label: color }))}
      />
      <Segmented
        label="Verhalten"
        showLabel
        value={config.behavior}
        onChange={(behavior) => onChange({ ...config, behavior })}
        options={[
          { value: 'momentary', label: 'Halten' },
          { value: 'latching', label: 'Umschalten' },
        ]}
        hint={config.behavior === 'momentary' ? 'An, solange gedrückt (Momentary).' : 'Ein Druck an, der nächste aus (Latching).'}
      />
      <Select
        label="Zielgerät"
        value={config.targetLogicalDeviceId ?? ''}
        onChange={(e) => onChange({ ...config, targetLogicalDeviceId: e.target.value || undefined })}
        options={[{ value: '', label: '— Gerät wählen —' }, ...devices.map((device) => ({ value: device.id, label: device.name }))]}
      />
      <Field label="Command-Type" value={config.commandType} onChange={(e) => onChange({ ...config, commandType: e.target.value })} />
      <TextArea
        label="Payload (JSON)"
        rows={3}
        className="font-sb-mono text-sm"
        value={config.commandPayloadJson}
        error={payloadValid ? undefined : 'Ungültiges JSON'}
        onChange={(e) => onChange({ ...config, commandPayloadJson: e.target.value })}
      />
      {config.commandType === 'click.extend' && (
        <Field
          label="Takte"
          hint="Wie weit der Endpunkt bei jedem Druck verschoben wird (#231)."
          type="number"
          min={1}
          step={1}
          value={String(parsePayload(config.commandPayloadJson).bars ?? 1)}
          onChange={(e) => {
            const bars = Math.max(1, Math.round(Number(e.target.value) || 1))
            onChange({ ...config, commandPayloadJson: JSON.stringify({ ...parsePayload(config.commandPayloadJson), bars }) })
          }}
        />
      )}
      <SizeRatioSlider
        label="Größe"
        ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
        onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
      />
    </div>
  )
}
