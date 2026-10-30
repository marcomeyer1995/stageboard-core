import { useState } from 'react'
import type { TFunction } from 'i18next'
import { CAPABILITIES, PLAYBACK_CUE_TARGET } from 'shared-types'
import { describeAction, describeSteps, PLAYBACK_OPS, SECTION_OPS, sectionOpJumps, type Action, type SectionOp, type WaitUnit } from '../lib/actions'
import { commandsFor, describeCue } from '../lib/deviceCommands'
import { FIXED_ACTIONS, ONE_BUTTON_SHOW, SONG_STATES, STEP_CHOICES, STEP_LABEL, type SongState, type StepAction } from '../lib/keybindings'
import type { JumpWhen } from '../lib/showSections'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { CueDialog } from './timeline/CueDialog'
import { Icon } from './Icon'
import { AddRow, Button, Dialog, Field, Segmented, Stepper, choiceRow } from './ui'
import { INPUT_FREE } from './ui/styles'
import { useTranslation } from 'react-i18next'

type Group = 'show' | 'section' | 'playback' | 'device' | 'steps'

const GROUPS: Group[] = ['show', 'section', 'playback', 'device', 'steps']

function groupOf(action: Action | null): Group {
  if (!action || action.kind === 'show' || action.kind === 'by-state') return 'show'
  return action.kind
}

/** An action in words, with the device's name for a device command. */
export function useDescribeAction(): (action: Action) => string {
  const { t } = useTranslation('actions')
  const devices = useLogicalDevicesStore((state) => state.devices)
  const describe = (action: Action): string => {
    if (action.kind === 'steps') return describeSteps(action.steps, describe)
    if (action.kind !== 'device') return describeAction(action)
    const device = devices.find((d) => d.id === action.targetLogicalDeviceId)
    return `${device?.name ?? t('deviceMissing')}: ${describeCue(action, device?.capability)}`
  }
  return describe
}

/**
 * One action as a row with "Ändern" - the same everywhere an action is chosen (docs/23 §7): pedal
 * keys now, MIDI controllers and widget buttons next. `optional`: "nichts" is a choice too.
 */
export function ActionField({
  label,
  value,
  onChange,
  optional = false,
  allowSequence = true,
}: {
  label: string
  value: Action | null
  onChange: (action: Action | null) => void
  optional?: boolean
  /** False inside a Folge's own steps - no Folge within a Folge. */
  allowSequence?: boolean
}) {
  const { t } = useTranslation('actions')
  const describe = useDescribeAction()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-ink-soft">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`min-w-0 flex-1 rounded-control bg-control px-3 py-2 text-base ${value ? 'text-ink' : 'text-ink-faint'}`}>{value ? describe(value) : t('nothing')}</span>
        <Button onClick={() => setOpen(true)}>{value ? t('change') : t('choose')}</Button>
        {optional && value && <Button onClick={() => onChange(null)}>{t('remove')}</Button>}
      </div>
      {open && (
        <ActionDialog
          title={label}
          allowSequence={allowSequence}
          initial={value}
          onSave={(action) => {
            onChange(action)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

/** Choosing an action: the group, then the action, then its values (docs/23 §7). */
export function ActionDialog({
  title,
  initial,
  onSave,
  onClose,
  allowSequence = true,
}: {
  title: string
  initial: Action | null
  onSave: (action: Action) => void
  onClose: () => void
  allowSequence?: boolean
}) {
  const { t } = useTranslation('actions')
  const devices = useLogicalDevicesStore((state) => state.devices)
  const describe = useDescribeAction()
  const [group, setGroup] = useState<Group>(groupOf(initial))
  const [draft, setDraft] = useState<Action | null>(initial)
  const [steps, setSteps] = useState<Record<SongState, StepAction>>(initial?.kind === 'by-state' ? initial.steps : ONE_BUTTON_SHOW)
  const [sectionOp, setSectionOp] = useState<SectionOp>(initial?.kind === 'section' ? initial.op : 'jump')
  const [label, setLabel] = useState(initial?.kind === 'section' ? (initial.label ?? '') : '')
  const [when, setWhen] = useState<JumpWhen>(initial?.kind === 'section' ? (initial.when ?? 'section') : 'section')
  const [deviceOpen, setDeviceOpen] = useState(false)
  const commandDevices = devices.filter((d) => d.id !== PLAYBACK_CUE_TARGET && d.capability !== CAPABILITIES.midiController && d.capability !== CAPABILITIES.clickTrack && commandsFor(d.capability).length > 0)
  const [folge, setFolge] = useState<DraftStep[]>(initial?.kind === 'steps' ? initial.steps : [{ wait: null, action: null }])

  const result: Action | null =
    group === 'section'
      ? sectionOp === 'jump' && label.trim() === ''
        ? null
        : { kind: 'section', op: sectionOp, ...(sectionOp === 'jump' ? { label: label.trim() } : {}), ...(sectionOpJumps(sectionOp) ? { when } : {}) }
      : group === 'steps'
        ? folge.length > 0 && folge.every((step) => step.action)
          ? { kind: 'steps', steps: folge.map((step) => ({ wait: step.wait, action: step.action! })) }
          : null
      : draft?.kind === 'by-state'
        ? { kind: 'by-state', steps }
        : draft && groupOf(draft) === group
          ? draft
          : null

  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!result} onClick={() => result && onSave(result)}>
            {t('apply')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented label={t('kind')} columns={3} value={group} onChange={setGroup} options={(allowSequence ? GROUPS : GROUPS.filter((g) => g !== 'steps')).map((g) => ({ value: g, label: t(`group.${g}`) }))} />

        {group === 'show' && (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('group.show')}>
            {FIXED_ACTIONS.map(({ id, label: text }) => {
              const chosen = draft?.kind === 'show' && draft.op === id
              return (
                <button key={id} type="button" role="radio" aria-checked={chosen} onClick={() => setDraft({ kind: 'show', op: id })} className={choiceRow(chosen)}>
                  {text}
                </button>
              )
            })}
            <button type="button" role="radio" aria-checked={draft?.kind === 'by-state'} onClick={() => setDraft({ kind: 'by-state', steps })} className={choiceRow(draft?.kind === 'by-state')}>
              {t('byState')}
            </button>
            {draft?.kind === 'by-state' && <StepsEditor steps={steps} onChange={setSteps} />}
          </div>
        )}

        {group === 'section' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('group.section')}>
              {SECTION_OPS.map(({ id, label: text }) => (
                <button key={id} type="button" role="radio" aria-checked={sectionOp === id} onClick={() => setSectionOp(id)} className={choiceRow(sectionOp === id)}>
                  {text}
                </button>
              ))}
            </div>
            {sectionOp === 'jump' && (
              <Field label={t('sectionName')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('sectionPlaceholder')} />
            )}
            {sectionOpJumps(sectionOp) && (
              <Segmented
                label={t('jumpAt')}
                showLabel
                value={when}
                onChange={setWhen}
                options={[
                  { value: 'bar', label: t('endBar') },
                  { value: 'section', label: t('endSection') },
                ]}
              />
            )}
          </div>
        )}

        {group === 'playback' && (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={t('group.playback')}>
            {PLAYBACK_OPS.map(({ id, label: text }) => {
              const chosen = draft?.kind === 'playback' && draft.op === id
              return (
                <button key={id} type="button" role="radio" aria-checked={chosen} onClick={() => setDraft({ kind: 'playback', op: id })} className={choiceRow(chosen)}>
                  {text}
                </button>
              )
            })}
          </div>
        )}

        {group === 'device' && (
          <div className="flex flex-col gap-2">
            <p className="text-base text-ink">{draft?.kind === 'device' ? describe(draft) : t('noCommand')}</p>
            <Button className="self-start" onClick={() => setDeviceOpen(true)}>
              {draft?.kind === 'device' ? t('changeCommand') : t('chooseCommand')}
            </Button>
            <p className="text-sm text-ink-faint">
              {commandDevices.length === 0
                ? t('noDevices')
                : t('likeCue')}
            </p>
          </div>
        )}
        {group === 'steps' && <FolgeEditor steps={folge} onChange={setFolge} />}
      </div>
      {deviceOpen && (
        <CueDialog
          title={t('controlDevice')}
          // Only devices with ready-made commands ("Rig wählen", "Patch") - nobody on stage types a
          // JSON payload (Marco, 2026-10-18). Click, track and announcements are under "Wiedergabe".
          devices={commandDevices}
          withPlayback={false}
          initial={draft?.kind === 'device' ? draft : undefined}
          onSubmit={(content) => {
            setDraft({ kind: 'device', targetLogicalDeviceId: content.targetLogicalDeviceId, type: content.type, payload: content.payload ?? {} })
            setDeviceOpen(false)
          }}
          onCancel={() => setDeviceOpen(false)}
        />
      )}
    </Dialog>
  )
}

/** "Je nach Zustand": what the key does in each song state (#27). */
export function StepsEditor({ steps, onChange }: { steps: Record<SongState, StepAction>; onChange: (steps: Record<SongState, StepAction>) => void }) {
  const { t } = useTranslation('actions')
  return (
    <div className="flex flex-col gap-2 rounded-container bg-control p-3">
      <p className="text-sm text-ink-muted">{t('stepsInfo')}</p>
      {SONG_STATES.map(({ id, label }) => (
        <label key={id} className="flex items-center gap-3">
          <span className="w-28 flex-shrink-0 text-base text-ink">{label}</span>
          <select
            value={steps[id]}
            onChange={(e) => onChange({ ...steps, [id]: e.target.value as StepAction })}
            aria-label={t('ifState', { state: label })}
            className={`min-h-form flex-1 min-w-0 px-3 text-base ${INPUT_FREE}`}
          >
            {STEP_CHOICES[id].map((step) => (
              <option key={step} value={step}>
                {STEP_LABEL[step]}
              </option>
            ))}
          </select>
        </label>
      ))}
      <Button className="self-start" onClick={() => onChange(ONE_BUTTON_SHOW)}>
        {t('oneButton')}
      </Button>
    </div>
  )
}

const WAIT_UNITS: WaitUnit[] = ['bars', 'beats', 'ms']
const waitUnitLabel = (t: TFunction<'actions'>, unit: WaitUnit, amount: number): string =>
  unit === 'ms' ? t('unit.ms') : amount === 1 ? t(unit === 'bars' ? 'unit.bar' : 'unit.beat') : t(`unit.${unit}`)

interface DraftStep {
  wait: { amount: number; unit: WaitUnit } | null
  action: Action | null
}

/**
 * A Folge (docs/23 §11.2): the steps, each further one with the wait before it - right inside the
 * action. To use the same Folge from several triggers, make it a switch.
 */
function FolgeEditor({ steps, onChange }: { steps: DraftStep[]; onChange: (steps: DraftStep[]) => void }) {
  const { t } = useTranslation('actions')
  const setStep = (index: number, step: DraftStep) => onChange(steps.map((s, i) => (i === index ? step : s)))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{t('seqInfo')}</p>
      {steps.map((step, index) => (
        <div key={index} className="flex flex-col gap-2 rounded-container bg-control p-3">
          {step.wait && (
            <div className="flex flex-col gap-2">
              <Stepper
                label={t('waitAfter')}
                value={step.wait.amount}
                unit={waitUnitLabel(t, step.wait.unit, step.wait.amount)}
                min={step.wait.unit === 'ms' ? 0 : 1}
                max={step.wait.unit === 'ms' ? 10000 : 64}
                step={step.wait.unit === 'ms' ? 100 : 1}
                onChange={(amount) => setStep(index, { ...step, wait: { amount, unit: step.wait!.unit } })}
              />
              <Segmented
                label={t('stepUnit', { n: index + 1 })}
                value={step.wait.unit}
                onChange={(unit) => setStep(index, { ...step, wait: { amount: unit === 'ms' ? 500 : 1, unit } })}
                options={WAIT_UNITS.map((u) => ({ value: u, label: t(`unit.${u}`) }))}
              />
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <ActionField label={t('stepN', { n: index + 1 })} value={step.action} onChange={(action) => setStep(index, { ...step, action })} allowSequence={false} />
            </div>
            {steps.length > 1 && (
              <Button
                className="w-12 flex-shrink-0"
                aria-label={t('removeStep', { n: index + 1 })}
                onClick={() => onChange(steps.filter((_, i) => i !== index).map((s, i) => (i === 0 ? { ...s, wait: null } : s)))}
              >
                <Icon name="close" />
              </Button>
            )}
          </div>
        </div>
      ))}
      <AddRow label={t('addStep')} onClick={() => onChange([...steps, { wait: { amount: 1, unit: 'bars' }, action: null }])} />
      <p className="text-sm text-ink-faint">{t('seqGrid')}</p>
    </div>
  )
}
