import { Field, Select } from '../components/ui'
import { useId, useState } from 'react'
import { BehaviorEditor } from '../components/BehaviorEditor'
import { needsShowControl, type Behavior } from '../lib/actions'
import { resolveHardwareBindingById } from '../lib/hardwareRouting'
import { useShowModeOnDemand } from '../lib/showMode'
import { isLatched, pressTrigger, releaseTrigger } from '../lib/triggerPress'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { useContentFontSizeStore } from '../store/useContentFontSizeStore'
import { useSwitchesStore } from '../store/useSwitchesStore'
import { DEFAULT_SIZE_RATIO, legacyPayloadUnreadable, triggerBehaviorOf, type CustomTriggerConfig } from './customTriggerConfig'
import { SizeRatioSlider } from './SizeRatioSlider'
import { WIDGET_COLORS, WIDGET_COLOR_SOLID } from './widgetColors'
import { stageFontSize } from '../lib/stageSize'

const INACTIVE_CLASS = 'bg-control-strong text-ink [@media(hover:hover)]:hover:bg-control-strong-hover'

/**
 * A button for any action (docs/23 §7, #547): show, sections, playback or a device command -
 * tastend (press + optional release), rastend (A/B) or zeitgesteuert, the same building block
 * as the pedal keys (triggerPress.ts). The rights are runAction's: show control only where the
 * musician may control the show - the button is greyed out elsewhere -, device commands from
 * anyone. A button set up before is read as the device command it always sent.
 */
export function CustomTriggerWidget({ config }: { config: CustomTriggerConfig }) {
  // The clock only at a press (#457).
  const show = useShowModeOnDemand()
  const devices = useLogicalDevicesStore((s) => s.devices)
  const id = `widget:${useId()}`
  const [on, setOn] = useState(() => isLatched(id))
  const [pressed, setPressed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Sized as a ratio of the device-wide default, not auto-fit to the tile (Marco,
  // 2026-09-14).
  const baseFontSize = useContentFontSizeStore((state) => state.baseFontSize)
  const fontSize = stageFontSize(baseFontSize * (config.sizeRatio ?? DEFAULT_SIZE_RATIO))

  const behavior = triggerBehaviorOf(config)
  // Bound to a switch (docs/23 §11): its name, colour, behaviour and state - shared with every
  // pedal and MIDI button that triggers it.
  const sw = useSwitchesStore((state) => (behavior?.kind === 'switch' ? state.switches.find((s) => s.id === behavior.switchId) : undefined))
  const switchState = useSwitchesStore((state) => (behavior?.kind === 'switch' ? (state.states[behavior.switchId] ?? 'off') : 'off'))
  const own = behavior?.kind === 'switch' ? sw?.behavior : behavior
  const first = own && own.kind !== 'switch' ? (own.kind === 'latching' ? own.on : own.press) : null
  const reason = !behavior
    ? 'Keine Aktion gewählt'
    : behavior.kind === 'switch' && !sw
      ? 'Schalter fehlt'
      : first?.kind === 'device' && !resolveHardwareBindingById(devices, first.targetLogicalDeviceId)
        ? 'Zielgerät fehlt'
        : first && needsShowControl(first) && !show.canControl
          ? 'Nur der Master steuert die Show'
          : null

  const report = (result: Promise<string | null> | null) => void result?.then(setError)

  function press(active: Behavior) {
    if (latching) setOn(!isLatched(id))
    else setPressed(true)
    report(pressTrigger(id, active, show))
  }

  function release(active: Behavior) {
    if (!pressed) return
    setPressed(false)
    report(releaseTrigger(id, active, show))
  }

  // A rastend switch is switched by a click like a rastend button; every other one is held.
  const latching = own?.kind === 'latching'
  const lit = sw ? switchState !== 'off' : latching ? on : pressed
  const label = sw && (config.label.trim() === '' || config.label === 'Trigger') ? sw.name : config.label
  const color = sw ? sw.color : config.color

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <button
        type="button"
        disabled={reason !== null}
        onClick={latching && behavior ? () => press(behavior) : undefined}
        onPointerDown={!latching && behavior ? () => press(behavior) : undefined}
        onPointerUp={!latching && behavior ? () => release(behavior) : undefined}
        onPointerLeave={!latching && behavior ? () => release(behavior) : undefined}
        className={`flex h-full min-h-touch flex-1 items-center justify-center overflow-hidden rounded-control font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          lit ? WIDGET_COLOR_SOLID[color] : INACTIVE_CLASS
        }`}
      >
        <span style={{ fontSize }} className="whitespace-nowrap">
          {label}
        </span>
      </button>
      {/* One line each: the button keeps its touch height, the hint gives way. */}
      {reason && <p className="flex-shrink-0 truncate text-xs text-ink-faint">{reason}</p>}
      {!reason && error && <p className="flex-shrink-0 truncate text-xs text-danger">{error}</p>}
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
  return (
    <div className="flex flex-col gap-3">
      <Field
        label="Beschriftung"
        value={config.label}
        onChange={(e) => onChange({ ...config, label: e.target.value })}
        hint={config.action?.kind === 'switch' ? 'Leer oder „Trigger“: der Name des Schalters.' : undefined}
      />
      {config.action?.kind !== 'switch' && (
        <Select
          label="Farbe"
          value={config.color}
          onChange={(e) => onChange({ ...config, color: e.target.value as CustomTriggerConfig['color'] })}
          options={WIDGET_COLORS.map((color) => ({ value: color, label: color }))}
        />
      )}
      {legacyPayloadUnreadable(config) && <p className="text-sm text-warn">Der bisherige Befehl hatte ungültiges JSON und wird ohne diese Werte gesendet - bitte neu wählen.</p>}
      <BehaviorEditor
        initial={triggerBehaviorOf(config)}
        onChange={(action) => {
          if (action && JSON.stringify(action) !== JSON.stringify(config.action)) onChange({ ...config, action })
        }}
      />
      <SizeRatioSlider
        label="Größe"
        ratio={config.sizeRatio ?? DEFAULT_SIZE_RATIO}
        onChange={(sizeRatio) => onChange({ ...config, sizeRatio })}
      />
    </div>
  )
}
