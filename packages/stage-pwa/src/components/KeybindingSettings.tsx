import { useEffect, useState } from 'react'
import { gridLabel, type Action, type Behavior, type Release } from '../lib/actions'
import { bindingForKey, isBindableKey, keyLabel, type KeyBinding } from '../lib/keybindings'
import { footswitchCapture } from '../lib/useFootswitch'
import { useKeybindingsStore } from '../store/useKeybindingsStore'
import { ActionField, useDescribeAction } from './ActionPicker'
import { Icon } from './Icon'
import { AddRow, Button, Dialog, Segmented, Stepper, Switch } from './ui'

/**
 * Foot switch mapping (#27): an empty list to start with - each mapping is set up step by step in
 * a popup (press the pedal, choose what it does). A key either has one fixed meaning or one per
 * song state ("Je nach Zustand"), so a single pedal can run the whole show.
 */
export function KeybindingSettings() {
  const bindings = useKeybindingsStore((state) => state.bindings)
  const save = useKeybindingsStore((state) => state.save)
  const remove = useKeybindingsStore((state) => state.remove)
  const [editing, setEditing] = useState<KeyBinding | 'new' | null>(null)
  const describeMapping = useDescribeBehavior()

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        Bluetooth-Pedal (z. B. AirTurn, PageFlip) wie eine Tastatur koppeln, dann hier Zuordnungen anlegen. Wirkt auf den
        Dashboards. Show und Abschnitte steuert nur, wer die Show steuern darf (der Master); Gerätebefehle und Prompter blättern
        gehen auf jedem Gerät.
      </p>
      {bindings.length === 0 ? (
        <p className="text-base text-ink-soft">Noch keine Zuordnung.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Zuordnungen">
          {bindings.map((binding) => (
            <li key={binding.key} className="flex items-center gap-2 rounded-control bg-control px-3 py-2">
              <span className="flex-shrink-0 rounded-control bg-control-strong px-3 py-2 text-sm font-bold text-ink">{keyLabel(binding.key)}</span>
              <button
                type="button"
                onClick={() => setEditing(binding)}
                className="min-h-form min-w-0 flex-1 rounded-control px-2 text-left text-base text-ink [@media(hover:hover)]:hover:bg-control-hover"
              >
                {describeMapping(binding.behavior)}
              </button>
              <Button className="w-12 flex-shrink-0" onClick={() => remove(binding.key)} aria-label={`Zuordnung für ${keyLabel(binding.key)} löschen`}>
                <Icon name="close" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AddRow label="Neue Zuordnung" onClick={() => setEditing('new')} />
      {editing && (
        <KeyMappingDialog
          initial={editing === 'new' ? null : editing}
          onSave={(binding) => {
            save(binding, editing === 'new' ? undefined : editing.key)
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

type Mode = 'momentary' | 'latching' | 'timed'

/** A mapping in one line, with device names. */
function useDescribeBehavior(): (behavior: Behavior) => string {
  const describe = useDescribeAction()
  return (behavior) => {
    if (behavior.kind === 'latching') return `${describe(behavior.on)} / ${describe(behavior.off)}`
    const press = describe(behavior.press)
    const { release } = behavior
    if (release.kind === 'on-release') return `${press} · Loslassen: ${describe(release.action)}`
    if (release.kind === 'after') return `${press} · nach ${release.amount} ${UNIT_LABEL[release.unit]}${gridLabel(release)}: ${describe(release.action)}`
    return press
  }
}

const UNIT_LABEL = { ms: 'ms', beats: 'Schlägen', bars: 'Takten' } as const
type Unit = keyof typeof UNIT_LABEL

/** The step-by-step popup (docs/23 §4a): 1. press the pedal, 2. how it behaves, 3. what it does. */
function KeyMappingDialog({ initial, onSave, onClose }: { initial: KeyBinding | null; onSave: (binding: KeyBinding) => void; onClose: () => void }) {
  const bindings = useKeybindingsStore((state) => state.bindings)
  const describeMapping = useDescribeBehavior()
  const start = initial?.behavior
  const [key, setKey] = useState<string | null>(initial?.key ?? null)
  const [mode, setMode] = useState<Mode>(start?.kind === 'latching' ? 'latching' : start?.release.kind === 'after' ? 'timed' : 'momentary')
  const [press, setPress] = useState<Action | null>(start?.kind === 'momentary' ? start.press : start?.kind === 'latching' ? start.on : null)
  const [second, setSecond] = useState<Action | null>(
    start?.kind === 'latching' ? start.off : start?.kind === 'momentary' && start.release.kind !== 'none' ? start.release.action : null,
  )
  const [amount, setAmount] = useState(start?.kind === 'momentary' && start.release.kind === 'after' ? start.release.amount : 2)
  const [unit, setUnit] = useState<Unit>(start?.kind === 'momentary' && start.release.kind === 'after' ? start.release.unit : 'bars')
  const [onGrid, setOnGrid] = useState(start?.kind === 'momentary' && start.release.kind === 'after' ? (start.release.onGrid ?? false) : true)
  const listening = key === null

  useEffect(() => {
    if (!listening) return
    footswitchCapture.active = true
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (!isBindableKey(event.key) || event.repeat) return
      setKey(event.key)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      footswitchCapture.active = false
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [listening, onClose])

  const takenBy = key && key !== initial?.key ? bindingForKey(bindings, key) : null
  const release: Release =
    mode === 'timed' && second ? { kind: 'after', amount, unit, action: second, ...(unit !== 'ms' && onGrid ? { onGrid: true } : {}) } : mode === 'momentary' && second ? { kind: 'on-release', action: second } : { kind: 'none' }
  const behavior: Behavior | null = !press
    ? null
    : mode === 'latching'
      ? second
        ? { kind: 'latching', on: press, off: second }
        : null
      : mode === 'timed' && !second
        ? null
        : { kind: 'momentary', press, release }

  return (
    <Dialog
      title={initial ? 'Zuordnung ändern' : 'Neue Zuordnung'}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!key || !behavior} onClick={() => key && behavior && onSave({ key, behavior })}>
            Speichern
          </Button>
        </>
      }
    >
      {listening ? (
        <div className="flex flex-col items-center gap-3 rounded-container bg-control p-6 text-center">
          <span className="text-2xl font-bold text-accent">Jetzt Pedal drücken …</span>
          <span className="text-sm text-ink-muted">oder eine Taste der Tastatur. Esc bricht ab.</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base text-ink-soft">Taste:</span>
            <span className="rounded-control bg-control-strong px-3 py-2 text-base font-bold text-ink">{keyLabel(key)}</span>
            <Button onClick={() => setKey(null)}>Andere Taste</Button>
          </div>
          {takenBy && (
            <p className="text-sm text-warn">
              {keyLabel(key)} ist schon belegt („{describeMapping(takenBy.behavior)}“) - beim Speichern wird das ersetzt.
            </p>
          )}
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
              <Stepper label="Nach" value={amount} unit={UNIT_LABEL[unit]} min={1} max={unit === 'ms' ? 10000 : 64} step={unit === 'ms' ? 100 : 1} onChange={setAmount} />
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
                      ? `Landet genau auf dem ${unit === 'bars' ? 'Taktanfang' : 'Schlag'}, gezählt vom nächsten zum Drücken - vorausgeplant wie ein Cue. Läuft der Song nicht, zählt die Zeit nach dem Songtempo.`
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
      )}
    </Dialog>
  )
}
