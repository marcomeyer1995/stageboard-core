import { useEffect, useState } from 'react'
import type { LogicalDevice } from 'shared-types'
import type { Behavior } from '../lib/actions'
import { describeOscTrigger, oscTriggerFrom, sameOscTrigger, type OscInputRule, type OscTrigger } from '../lib/oscInput'
import { getStageServerUrl } from '../lib/stageServer'
import { oscLearn } from '../lib/useOscInput'
import { useOscInputRulesStore } from '../store/useOscInputRulesStore'
import { BehaviorEditor, useDescribeBehavior } from './BehaviorEditor'
import { Icon } from './Icon'
import { AddRow, Button, Dialog, Field, Stepper, Switch } from './ui'

function newRuleId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The Stage-Server's OSC port, to tell the controller where to send (#484). */
function useOscInPort(): number | null {
  const [port, setPort] = useState<number | null>(null)
  useEffect(() => {
    const base = getStageServerUrl()
    if (!base) return
    let cancelled = false
    fetch(`${base}/osc-in/info`)
      .then((r) => (r.ok ? (r.json() as Promise<{ port: number }>) : null))
      .then((info) => !cancelled && info && setPort(info.port))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return port
}

/**
 * "Knöpfe belegen" for an OSC-Eingang (#484, docs/23 §4): its addresses and what each does -
 * band-wide, like the device. A button is learned by pressing it on the controller (the message
 * arrives through the Stage-Server on any tablet), or its address is typed in.
 */
export function OscInputButtonsDialog({ device, onClose }: { device: LogicalDevice; onClose: () => void }) {
  const docs = useOscInputRulesStore((state) => state.docs)
  const save = useOscInputRulesStore((state) => state.save)
  const describeBehavior = useDescribeBehavior()
  const port = useOscInPort()
  const rules = docs.find((d) => d.id === device.id)?.rules ?? []
  const [editing, setEditing] = useState<OscInputRule | 'new' | null>(null)
  const host = (() => {
    try {
      return new URL(getStageServerUrl() ?? '').hostname
    } catch {
      return 'Stage-Server'
    }
  })()

  const store = (next: OscInputRule[]) => save({ id: device.id, rules: next })

  return (
    <Dialog title={`${device.name}: Knöpfe`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-base text-ink">
          Den Controller senden lassen an <strong>{host}</strong>, Port <strong>{port ?? '…'}</strong>.
        </p>
        <p className="text-sm text-ink-muted">Jeder Knopf löst eine Aktion aus - wie ein Pedal: tastend, rastend oder zeitgesteuert. Ausgeführt vom Gerät, das die Show steuert.</p>
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
                  <span className="text-sm font-bold text-ink-soft">{describeOscTrigger(rule.trigger)}</span>
                  <span className="text-base text-ink">{describeBehavior(rule.behavior)}</span>
                </button>
                <Button className="w-12 flex-shrink-0" onClick={() => void store(rules.filter((r) => r.id !== rule.id))} aria-label={`Knopf ${describeOscTrigger(rule.trigger)} löschen`}>
                  <Icon name="close" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <AddRow label="Neuer Knopf" onClick={() => setEditing('new')} />
      </div>
      {editing && (
        <OscButtonDialog
          initial={editing === 'new' ? null : editing}
          rules={rules}
          onSave={(rule) => {
            // One address, one meaning: the same button saved again replaces its rule.
            void store([...rules.filter((r) => r.id !== rule.id && !sameOscTrigger(r.trigger, rule.trigger)), rule])
            setEditing(null)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Dialog>
  )
}

/** One button: 1. press it (or type its address), 2. how it behaves and what it does. */
function OscButtonDialog({
  initial,
  rules,
  onSave,
  onClose,
}: {
  initial: OscInputRule | null
  rules: readonly OscInputRule[]
  onSave: (rule: OscInputRule) => void
  onClose: () => void
}) {
  const describeBehavior = useDescribeBehavior()
  const setLearning = useOscInputRulesStore((state) => state.setLearning)
  const [trigger, setTrigger] = useState<OscTrigger>(initial?.trigger ?? { address: '' })
  const [listening, setListening] = useState(!initial)
  const [behavior, setBehavior] = useState<Behavior | null>(initial?.behavior ?? null)

  useEffect(() => {
    if (!listening) return
    // Opens the stream on this device too, while it waits (useOscInput.ts).
    setLearning(true)
    oscLearn.capture = (message) => {
      setTrigger(oscTriggerFrom(message))
      setListening(false)
    }
    return () => {
      oscLearn.capture = null
      setLearning(false)
    }
  }, [listening, setLearning])

  const valid = /^\/\S*$/.test(trigger.address)
  const takenBy = rules.find((r) => r.id !== initial?.id && sameOscTrigger(r.trigger, trigger))

  return (
    <Dialog
      title={initial ? 'Knopf ändern' : 'Neuer Knopf'}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={listening || !behavior || !valid} onClick={() => behavior && onSave({ id: initial?.id ?? newRuleId(), trigger, behavior })}>
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
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label="Adresse" value={trigger.address} placeholder="/1/push1" onChange={(e) => setTrigger({ ...trigger, address: e.target.value.trim() })} error={valid || !trigger.address ? undefined : 'Beginnt mit „/“, ohne Leerzeichen.'} />
            </div>
            <Button onClick={() => setListening(true)}>Neu lernen</Button>
          </div>
          <Switch
            label="Nur bei einem Wert"
            checked={trigger.value !== undefined}
            onChange={(on) => setTrigger(on ? { ...trigger, value: 1 } : { address: trigger.address })}
            info="Für Controller, die mehrere Knöpfe über dieselbe Adresse mit verschiedenen Werten senden (/szene 1, /szene 2). Aus: ein Wert über 0 drückt, 0 lässt los."
          />
          {trigger.value !== undefined && <Stepper label="Wert" unit="" value={trigger.value} min={-1000} max={1000} step={1} onChange={(value) => setTrigger({ ...trigger, value })} />}
          {takenBy && <p className="text-sm text-warn">Dieser Knopf ist schon belegt („{describeBehavior(takenBy.behavior)}“) - beim Speichern wird das ersetzt.</p>}
          <BehaviorEditor initial={behavior} onChange={setBehavior} />
        </div>
      )}
    </Dialog>
  )
}
