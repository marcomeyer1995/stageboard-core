import { useEffect, useState } from 'react'
import { gridLabel, type Action, type Behavior, type Release } from '../lib/actions'
import { useSwitchesStore } from '../store/useSwitchesStore'
import { ActionField, useDescribeAction } from './ActionPicker'
import { SwitchDialog } from './SwitchEditor'
import { AddRow, Button, Segmented, Stepper, Switch, choiceRow } from './ui'

type Mode = 'momentary' | 'latching' | 'timed'

const UNIT_LABEL = { ms: 'ms', beats: 'Schlägen', bars: 'Takten' } as const
type Unit = keyof typeof UNIT_LABEL
/** "nach 1 Takt", "nach 2 Takten". */
const unitLabel = (unit: Unit, amount: number): string => (amount === 1 && unit !== 'ms' ? (unit === 'bars' ? 'Takt' : 'Schlag') : UNIT_LABEL[unit])

/** A mapping in one line, with device names - for lists of pedal keys and the like. */
export function useDescribeBehavior(): (behavior: Behavior) => string {
  const describe = useDescribeAction()
  const switches = useSwitchesStore((state) => state.switches)
  return (behavior) => {
    if (behavior.kind === 'switch') return `Schalter „${switches.find((s) => s.id === behavior.switchId)?.name ?? 'gelöscht'}“`
    if (behavior.kind === 'latching') return `${describe(behavior.on)} / ${describe(behavior.off)}`
    const press = describe(behavior.press)
    const { release } = behavior
    if (release.kind === 'on-release') return `${press} · Loslassen: ${describe(release.action)}`
    if (release.kind === 'after') return `${press} · nach ${release.amount} ${unitLabel(release.unit, release.amount)}${gridLabel(release)}: ${describe(release.action)}`
    return press
  }
}

/**
 * How a trigger behaves and what it does (docs/23 §4a) - the same for a pedal key and a widget
 * button: tastend, rastend or zeitgesteuert, then the actions. Reports the behaviour whenever it
 * is complete, null while something is still missing.
 */
export function BehaviorEditor({
  initial,
  onChange,
  allowSwitch = true,
}: {
  initial: Behavior | null
  onChange: (behavior: Behavior | null) => void
  /** False in a switch's own editor - a switch never points to another. */
  allowSwitch?: boolean
}) {
  const switches = useSwitchesStore((state) => state.switches)
  const [useSwitch, setUseSwitch] = useState(initial?.kind === 'switch')
  const [switchId, setSwitchId] = useState<string | null>(initial?.kind === 'switch' ? initial.switchId : null)
  const [own, setOwn] = useState<Behavior | null>(initial?.kind === 'switch' ? null : initial)
  const [editing, setEditing] = useState<'new' | 'save-as' | string | null>(null)

  const result: Behavior | null = useSwitch ? (switchId ? { kind: 'switch', switchId } : null) : own
  const key = JSON.stringify(result)
  useEffect(() => {
    onChange(key === 'null' ? null : (JSON.parse(key) as Behavior))
    // Only when the result itself changes - onChange is a fresh function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!allowSwitch) return <OwnBehaviorEditor initial={own} onChange={setOwn} />

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label="Belegung"
        showLabel
        value={useSwitch ? 'switch' : 'own'}
        onChange={(value) => setUseSwitch(value === 'switch')}
        options={[
          { value: 'switch', label: 'Schalter' },
          { value: 'own', label: 'Eigene Belegung' },
        ]}
        hint={
          useSwitch
            ? 'Ein Schalter der Band, z. B. „Blinder“: einmal eingerichtet, von Pedal, MIDI-Knopf und Dashboard-Knopf gleich ausgelöst - alle zeigen denselben Zustand.'
            : 'Nur für diesen Auslöser. Mit „Als Schalter speichern“ für andere Auslöser wiederverwendbar.'
        }
      />
      {useSwitch ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Schalter">
            {switches.map((sw) => (
              <div key={sw.id} className="flex items-center gap-2">
                <button type="button" role="radio" aria-checked={switchId === sw.id} onClick={() => setSwitchId(sw.id)} className={`flex-1 min-w-0 ${choiceRow(switchId === sw.id)}`}>
                  {sw.name}
                </button>
                <Button className="flex-shrink-0" onClick={() => setEditing(sw.id)}>
                  Bearbeiten
                </Button>
              </div>
            ))}
          </div>
          <AddRow label="Neuer Schalter" onClick={() => setEditing('new')} />
        </div>
      ) : (
        <>
          <OwnBehaviorEditor initial={own} onChange={setOwn} />
          {own && (
            <Button className="self-start" onClick={() => setEditing('save-as')}>
              Als Schalter speichern…
            </Button>
          )}
        </>
      )}
      {editing && (
        <SwitchDialog
          initial={editing === 'new' ? null : editing === 'save-as' ? { behavior: own! } : (switches.find((s) => s.id === editing) ?? null)}
          onSaved={(sw) => {
            setSwitchId(sw.id)
            setUseSwitch(true)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/** Tastend, rastend or zeitgesteuert with its actions - a trigger's own setup or a switch's. */
function OwnBehaviorEditor({ initial, onChange }: { initial: Behavior | null; onChange: (behavior: Behavior | null) => void }) {
  const start = initial?.kind === 'switch' ? null : initial
  const [mode, setMode] = useState<Mode>(start?.kind === 'latching' ? 'latching' : start?.release.kind === 'after' ? 'timed' : 'momentary')
  const [press, setPress] = useState<Action | null>(start?.kind === 'momentary' ? start.press : start?.kind === 'latching' ? start.on : null)
  const [second, setSecond] = useState<Action | null>(
    start?.kind === 'latching' ? start.off : start?.kind === 'momentary' && start.release.kind !== 'none' ? start.release.action : null,
  )
  const [amount, setAmount] = useState(start?.kind === 'momentary' && start.release.kind === 'after' ? start.release.amount : 2)
  const [unit, setUnit] = useState<Unit>(start?.kind === 'momentary' && start.release.kind === 'after' ? start.release.unit : 'bars')
  const [onGrid, setOnGrid] = useState(start?.kind === 'momentary' && start.release.kind === 'after' ? (start.release.onGrid ?? false) : true)

  const release: Release =
    mode === 'timed' && second
      ? { kind: 'after', amount, unit, action: second, ...(unit !== 'ms' && onGrid ? { onGrid: true } : {}) }
      : mode === 'momentary' && second
        ? { kind: 'on-release', action: second }
        : { kind: 'none' }
  const behavior: Behavior | null = !press
    ? null
    : mode === 'latching'
      ? second
        ? { kind: 'latching', on: press, off: second }
        : null
      : mode === 'timed' && !second
        ? null
        : { kind: 'momentary', press, release }

  const key = JSON.stringify(behavior)
  useEffect(() => {
    onChange(key === 'null' ? null : (JSON.parse(key) as Behavior))
    // Only when the behaviour itself changes - onChange is a fresh function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label="Verhalten"
        showLabel
        value={mode}
        onChange={setMode}
        options={[
          { value: 'momentary', label: 'Tastend' },
          { value: 'latching', label: 'Rastend' },
          { value: 'timed', label: 'Zeitgesteuert' },
        ]}
        hint={
          mode === 'momentary'
            ? 'Drücken löst die Aktion aus, Loslassen auf Wunsch eine zweite.'
            : mode === 'latching'
              ? 'Erster Druck: erste Aktion, zweiter Druck: zweite - z. B. Effekt an / aus.'
              : 'Drücken löst die Aktion aus, die zweite folgt von selbst nach der eingestellten Zeit.'
        }
      />
      <ActionField label={mode === 'latching' ? '1. Druck' : 'Beim Drücken'} value={press} onChange={setPress} />
      {mode === 'timed' && (
        <div className="flex flex-col gap-2">
          <Stepper label="Nach" value={amount} unit={unitLabel(unit, amount)} min={1} max={unit === 'ms' ? 10000 : 64} step={unit === 'ms' ? 100 : 1} onChange={setAmount} />
          <Segmented
            label="Einheit"
            value={unit}
            onChange={(next) => {
              setUnit(next)
              setAmount(next === 'ms' ? 1000 : 2)
            }}
            options={[
              { value: 'bars', label: 'Takte' },
              { value: 'beats', label: 'Schläge' },
              { value: 'ms', label: 'ms' },
            ]}
          />
          {unit !== 'ms' && (
            <Switch
              label={unit === 'bars' ? 'Auf den Takt' : 'Auf den Schlag'}
              checked={onGrid}
              onChange={setOnGrid}
              description={
                onGrid
                  ? `Landet genau auf einem ${unit === 'bars' ? 'Taktanfang' : 'Schlag'} - gezählt ab dem, der dem Drücken am nächsten liegt, und vorausgeplant wie ein Cue. Läuft der Song nicht, zählt die Zeit nach dem Songtempo.`
                  : 'Zählt ab dem Drücken nach dem Tempo in dem Moment - nicht auf den Schlag genau.'
              }
            />
          )}
        </div>
      )}
      <ActionField
        label={mode === 'latching' ? '2. Druck' : mode === 'timed' ? 'Danach' : 'Beim Loslassen (optional)'}
        value={second}
        onChange={setSecond}
        optional={mode === 'momentary'}
      />
    </div>
  )
}
