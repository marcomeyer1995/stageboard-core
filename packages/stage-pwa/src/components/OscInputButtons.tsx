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
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation('hardware')
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
      return t('server')
    }
  })()

  const store = (next: OscInputRule[]) => save({ id: device.id, rules: next })

  return (
    <Dialog title={t('midi.title', { device: device.name })} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-base text-ink">
          {t('osc.sendTo')}
          <strong>{host}</strong>
          {t('osc.port')}
          <strong>{port ?? '…'}</strong>.
        </p>
        <p className="text-sm text-ink-muted">{t('osc.intro')}</p>
        {rules.length === 0 ? (
          <p className="text-base text-ink-soft">{t('midi.none')}</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t('midi.list')}>
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
                <Button className="w-12 flex-shrink-0" onClick={() => void store(rules.filter((r) => r.id !== rule.id))} aria-label={t('midi.delete', { trigger: describeOscTrigger(rule.trigger) })}>
                  <Icon name="close" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <AddRow label={t('midi.new')} onClick={() => setEditing('new')} />
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
  const { t } = useTranslation('hardware')
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
      title={initial ? t('midi.change') : t('midi.new')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={listening || !behavior || !valid} onClick={() => behavior && onSave({ id: initial?.id ?? newRuleId(), trigger, behavior })}>
            {t('save')}
          </Button>
        </>
      }
    >
      {listening ? (
        <div className="flex flex-col items-center gap-3 rounded-container bg-control p-6 text-center">
          <span className="text-2xl font-bold text-accent">{t('midi.press')}</span>
          <Button onClick={() => setListening(false)}>{t('midi.byHand')}</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <Field label={t('osc.address')} value={trigger.address} placeholder="/1/push1" onChange={(e) => setTrigger({ ...trigger, address: e.target.value.trim() })} error={valid || !trigger.address ? undefined : t('osc.addressError')} />
            </div>
            <Button onClick={() => setListening(true)}>{t('midi.relearn')}</Button>
          </div>
          <Switch
            label={t('midi.onlyValue')}
            checked={trigger.value !== undefined}
            onChange={(on) => setTrigger(on ? { ...trigger, value: 1 } : { address: trigger.address })}
            info={t('osc.onlyValueInfo')}
          />
          {trigger.value !== undefined && <Stepper label={t('midi.value')} unit="" value={trigger.value} min={-1000} max={1000} step={1} onChange={(value) => setTrigger({ ...trigger, value })} />}
          {takenBy && <p className="text-sm text-warn">{t('midi.taken', { mapping: describeBehavior(takenBy.behavior) })}</p>}
          <BehaviorEditor initial={behavior} onChange={setBehavior} />
        </div>
      )}
    </Dialog>
  )
}
