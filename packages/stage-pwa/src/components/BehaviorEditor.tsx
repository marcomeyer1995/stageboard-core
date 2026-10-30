import { useEffect, useState } from 'react'
import type { TFunction } from 'i18next'
import { gridLabel, type Action, type Behavior, type Release } from '../lib/actions'
import { useSwitchesStore } from '../store/useSwitchesStore'
import { ActionField, useDescribeAction } from './ActionPicker'
import { SwitchDialog } from './SwitchEditor'
import { AddRow, Button, Segmented, Stepper, Switch, choiceRow } from './ui'
import { useTranslation } from 'react-i18next'

type Mode = 'momentary' | 'latching' | 'timed'

type Unit = 'ms' | 'beats' | 'bars'
/** "nach 1 Takt", "nach 2 Takten" - in the device's language. */
const unitLabel = (t: TFunction<'actions'>, unit: Unit, amount: number): string =>
  amount === 1 && unit !== 'ms' ? t(unit === 'bars' ? 'unit.bar' : 'unit.beat') : t(`unitAfter.${unit}`)

/** A mapping in one line, with device names - for lists of pedal keys and the like. */
export function useDescribeBehavior(): (behavior: Behavior) => string {
  const { t } = useTranslation('actions')
  const describe = useDescribeAction()
  const switches = useSwitchesStore((state) => state.switches)
  return (behavior) => {
    if (behavior.kind === 'switch') return t('switchNamed', { name: switches.find((s) => s.id === behavior.switchId)?.name ?? t('deleted') })
    if (behavior.kind === 'latching') return `${describe(behavior.on)} / ${describe(behavior.off)}`
    const press = describe(behavior.press)
    const { release } = behavior
    if (release.kind === 'on-release') return t('release', { press, action: describe(release.action) })
    if (release.kind === 'after')
      return t('after', { press, amount: release.amount, unit: unitLabel(t, release.unit, release.amount), grid: gridLabel(release), action: describe(release.action) })
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
  const { t } = useTranslation('actions')
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
        label={t('mapping')}
        showLabel
        value={useSwitch ? 'switch' : 'own'}
        onChange={(value) => setUseSwitch(value === 'switch')}
        options={[
          { value: 'switch', label: t('switch') },
          { value: 'own', label: t('own') },
        ]}
        hint={
          useSwitch
            ? t('switchHint')
            : t('ownHint')
        }
      />
      {useSwitch ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('switches')}>
            {switches.map((sw) => (
              <div key={sw.id} className="flex items-center gap-2">
                <button type="button" role="radio" aria-checked={switchId === sw.id} onClick={() => setSwitchId(sw.id)} className={`flex-1 min-w-0 ${choiceRow(switchId === sw.id)}`}>
                  {sw.name}
                </button>
                <Button className="flex-shrink-0" onClick={() => setEditing(sw.id)}>
                  {t('edit')}
                </Button>
              </div>
            ))}
          </div>
          <AddRow label={t('newSwitch')} onClick={() => setEditing('new')} />
        </div>
      ) : (
        <>
          <OwnBehaviorEditor initial={own} onChange={setOwn} />
          {own && (
            <Button className="self-start" onClick={() => setEditing('save-as')}>
              {t('saveAsSwitch')}
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
  const { t } = useTranslation('actions')
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
        label={t('behavior')}
        showLabel
        value={mode}
        onChange={setMode}
        options={[
          { value: 'momentary', label: t('momentary') },
          { value: 'latching', label: t('latching') },
          { value: 'timed', label: t('timed') },
        ]}
        hint={
          mode === 'momentary'
            ? t('momentaryHint')
            : mode === 'latching'
              ? t('latchingHint')
              : t('timedHint')
        }
      />
      <ActionField label={mode === 'latching' ? t('firstPress') : t('onPress')} value={press} onChange={setPress} />
      {mode === 'timed' && (
        <div className="flex flex-col gap-2">
          <Stepper label={t('after2')} value={amount} unit={unitLabel(t, unit, amount)} min={1} max={unit === 'ms' ? 10000 : 64} step={unit === 'ms' ? 100 : 1} onChange={setAmount} />
          <Segmented
            label={t('unitLabel')}
            value={unit}
            onChange={(next) => {
              setUnit(next)
              setAmount(next === 'ms' ? 1000 : 2)
            }}
            options={[
              { value: 'bars', label: t('unit.bars') },
              { value: 'beats', label: t('unit.beats') },
              { value: 'ms', label: t('unit.ms') },
            ]}
          />
          {unit !== 'ms' && (
            <Switch
              label={unit === 'bars' ? t('onTheBar') : t('onTheBeat')}
              checked={onGrid}
              onChange={setOnGrid}
              info={
                onGrid
                  ? t(unit === 'bars' ? 'onGridBarInfo' : 'onGridBeatInfo')
                  : t('offGridInfo')
              }
            />
          )}
        </div>
      )}
      <ActionField
        label={mode === 'latching' ? t('secondPress') : mode === 'timed' ? t('then') : t('onRelease')}
        value={second}
        onChange={setSecond}
        optional={mode === 'momentary'}
      />
    </div>
  )
}
