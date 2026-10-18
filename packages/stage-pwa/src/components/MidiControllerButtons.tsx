import { useEffect, useState } from 'react'
import type { LogicalDevice } from 'shared-types'
import type { Behavior } from '../lib/actions'
import { getDeviceId } from '../lib/deviceId'
import { describeMidiTrigger, sameMidiTrigger, triggerFromEvent, type MidiControllerRule, type MidiMessageKind, type MidiTrigger } from '../lib/midiControllerRules'
import { midiLearn } from '../lib/useMidiControllers'
import { useMidiControllerRulesStore } from '../store/useMidiControllerRulesStore'
import { BehaviorEditor, useDescribeBehavior } from './BehaviorEditor'
import { Icon } from './Icon'
import { AddRow, Button, Dialog, Segmented, Stepper, Switch } from './ui'

function newRuleId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * "Knöpfe belegen" for a MIDI controller (#547 step 2, docs/23 §7): its buttons and what each
 * does - band-wide, like the controller device. A button is learned by pressing it on the tablet
 * the controller is plugged into, or entered by hand anywhere.
 */
export function MidiControllerButtonsDialog({ device, onClose }: { device: LogicalDevice; onClose: () => void }) {
  const docs = useMidiControllerRulesStore((state) => state.docs)
  const save = useMidiControllerRulesStore((state) => state.save)
  const describeBehavior = useDescribeBehavior()
  const rules = docs.find((d) => d.id === device.id)?.rules ?? []
  const [editing, setEditing] = useState<MidiControllerRule | 'new' | null>(null)
  const canLearn = device.executionTarget === getDeviceId()

  const store = (next: MidiControllerRule[]) => save({ id: device.id, rules: next })

  return (
    <Dialog title={`${device.name}: Knöpfe`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-muted">
          Jeder Knopf löst eine Aktion aus - wie ein Pedal: tastend, rastend oder zeitgesteuert. Show und Abschnitte nur, wenn das Tablet, an
          dem der Controller steckt, die Show steuern darf.
        </p>
        {rules.length === 0 ? (
          <p className="text-base text-ink-soft">Noch kein Knopf belegt.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Knöpfe">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-2 rounded-control bg-control px-3 py-2">
                <button
                  type="button"
                  onClick={() => setEditing(rule)}
                  className="flex min-h-form min-w-0 flex-1 flex-col rounded-control px-2 py-1 text-left [@media(hover:hover)]:hover:bg-control-hover"
                >
                  <span className="text-sm font-bold text-ink-soft">{describeMidiTrigger(rule.trigger)}</span>
                  <span className="text-base text-ink">{describeBehavior(rule.behavior)}</span>
                </button>
                <Button
                  className="w-12 flex-shrink-0"
                  onClick={() => void store(rules.filter((r) => r.id !== rule.id))}
                  aria-label={`Knopf ${describeMidiTrigger(rule.trigger)} löschen`}
                >
                  <Icon name="close" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <AddRow label="Neuer Knopf" onClick={() => setEditing('new')} />
      </div>
      {editing && (
        <MidiButtonDialog
          deviceId={device.id}
          initial={editing === 'new' ? null : editing}
          canLearn={canLearn}
          rules={rules}
          onSave={(rule) => {
            // One button, one meaning: the same button saved again replaces its rule.
            void store([...rules.filter((r) => r.id !== rule.id && !sameMidiTrigger(r.trigger, rule.trigger)), rule])
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Dialog>
  )
}

const KINDS: { value: MidiMessageKind; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'cc', label: 'CC' },
  { value: 'program', label: 'Program' },
]

/** One button: 1. press it (or enter it), 2. how it behaves and what it does. */
function MidiButtonDialog({
  deviceId,
  initial,
  canLearn,
  rules,
  onSave,
  onClose,
}: {
  deviceId: string
  initial: MidiControllerRule | null
  canLearn: boolean
  rules: readonly MidiControllerRule[]
  onSave: (rule: MidiControllerRule) => void
  onClose: () => void
}) {
  const describeBehavior = useDescribeBehavior()
  const [trigger, setTrigger] = useState<MidiTrigger>(initial?.trigger ?? { message: 'note', channel: 1, number: 60 })
  const [listening, setListening] = useState(!initial && canLearn)
  const [behavior, setBehavior] = useState<Behavior | null>(initial?.behavior ?? null)

  useEffect(() => {
    if (!listening) return
    midiLearn.capture = (controllerId, event) => {
      if (controllerId !== deviceId) return
      setTrigger(triggerFromEvent(event))
      setListening(false)
    }
    return () => {
      midiLearn.capture = null
    }
  }, [listening, deviceId])

  const takenBy = rules.find((r) => r.id !== initial?.id && sameMidiTrigger(r.trigger, trigger))

  return (
    <Dialog
      title={initial ? 'Knopf ändern' : 'Neuer Knopf'}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={listening || !behavior} onClick={() => behavior && onSave({ id: initial?.id ?? newRuleId(), trigger, behavior })}>
            Speichern
          </Button>
        </>
      }
    >
      {listening ? (
        <div className="flex flex-col items-center gap-3 rounded-container bg-control p-6 text-center">
          <span className="text-2xl font-bold text-accent">Jetzt Knopf am Controller drücken …</span>
          <Button onClick={() => setListening(false)}>Von Hand eintragen</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-control bg-control-strong px-3 py-2 text-base font-bold text-ink">{describeMidiTrigger(trigger)}</span>
            {canLearn && <Button onClick={() => setListening(true)}>Neu lernen</Button>}
          </div>
          {!canLearn && <p className="text-sm text-ink-muted">Lernen geht nur am Tablet, an dem der Controller steckt - hier von Hand eintragen.</p>}
          <Segmented label="Art" showLabel value={trigger.message} onChange={(message) => setTrigger({ message, channel: trigger.channel, number: trigger.number })} options={KINDS} />
          <Stepper label="Kanal" unit="" value={trigger.channel} min={1} max={16} step={1} onChange={(channel) => setTrigger({ ...trigger, channel })} />
          <Stepper label="Nummer" unit="" value={trigger.number} min={0} max={127} step={1} onChange={(number) => setTrigger({ ...trigger, number })} />
          {trigger.message === 'cc' && (
            <>
              <Switch
                label="Nur bei einem Wert"
                checked={trigger.value !== undefined}
                onChange={(on) => setTrigger(on ? { ...trigger, value: 127 } : { message: 'cc', channel: trigger.channel, number: trigger.number })}
                description="Für Controller, die mehrere Knöpfe über denselben CC mit verschiedenen Werten senden. Aus: jeder Wert über 0 drückt, 0 lässt los."
              />
              {trigger.value !== undefined && (
                <Stepper label="Wert" unit="" value={trigger.value} min={0} max={127} step={1} onChange={(value) => setTrigger({ ...trigger, value })} />
              )}
            </>
          )}
          {takenBy && <p className="text-sm text-warn">Dieser Knopf ist schon belegt („{describeBehavior(takenBy.behavior)}“) - beim Speichern wird das ersetzt.</p>}
          <BehaviorEditor initial={behavior} onChange={setBehavior} />
        </div>
      )}
    </Dialog>
  )
}
