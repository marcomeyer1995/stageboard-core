import { useState } from 'react'
import { CAPABILITIES, PLAYBACK_CUE_TARGET } from 'shared-types'
import { describeAction, PLAYBACK_OPS, SECTION_OPS, sectionOpJumps, type Action, type ActionSequence, type SectionOp, type WaitUnit } from '../lib/actions'
import { commandsFor, describeCue } from '../lib/deviceCommands'
import { FIXED_ACTIONS, ONE_BUTTON_SHOW, SONG_STATES, STEP_CHOICES, STEP_LABEL, type SongState, type StepAction } from '../lib/keybindings'
import type { JumpWhen } from '../lib/showSections'
import { useActionSequencesStore } from '../store/useActionSequencesStore'
import { useDialogStore } from '../store/useDialogStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { CueDialog } from './timeline/CueDialog'
import { Icon } from './Icon'
import { AddRow, Button, Dialog, Field, Segmented, Stepper, choiceRow } from './ui'
import { INPUT_FREE } from './ui/styles'

type Group = 'show' | 'section' | 'playback' | 'device' | 'sequence'

const GROUPS: { value: Group; label: string }[] = [
  { value: 'show', label: 'Show' },
  { value: 'section', label: 'Abschnitte' },
  { value: 'playback', label: 'Wiedergabe' },
  { value: 'device', label: 'Gerät' },
  { value: 'sequence', label: 'Ablauf' },
]

function groupOf(action: Action | null): Group {
  if (!action || action.kind === 'show' || action.kind === 'by-state') return 'show'
  return action.kind
}

/** An action in words, with the device's name for a device command. */
export function useDescribeAction(): (action: Action) => string {
  const devices = useLogicalDevicesStore((state) => state.devices)
  const sequences = useActionSequencesStore((state) => state.sequences)
  return (action) => {
    if (action.kind === 'sequence') return `Ablauf „${sequences.find((q) => q.id === action.sequenceId)?.name ?? 'gelöscht'}“`
    if (action.kind !== 'device') return describeAction(action)
    const device = devices.find((d) => d.id === action.targetLogicalDeviceId)
    return `${device?.name ?? 'Gerät fehlt'}: ${describeCue(action, device?.capability)}`
  }
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
  /** False inside a sequence's own steps - no sequence within a sequence. */
  allowSequence?: boolean
}) {
  const describe = useDescribeAction()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-ink-soft">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`min-w-0 flex-1 rounded-control bg-control px-3 py-2 text-base ${value ? 'text-ink' : 'text-ink-faint'}`}>{value ? describe(value) : 'nichts'}</span>
        <Button onClick={() => setOpen(true)}>{value ? 'Ändern' : 'Wählen'}</Button>
        {optional && value && <Button onClick={() => onChange(null)}>Entfernen</Button>}
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
  const devices = useLogicalDevicesStore((state) => state.devices)
  const describe = useDescribeAction()
  const [group, setGroup] = useState<Group>(groupOf(initial))
  const [draft, setDraft] = useState<Action | null>(initial)
  const [steps, setSteps] = useState<Record<SongState, StepAction>>(initial?.kind === 'by-state' ? initial.steps : ONE_BUTTON_SHOW)
  const [sectionOp, setSectionOp] = useState<SectionOp>(initial?.kind === 'section' ? initial.op : 'jump')
  const [label, setLabel] = useState(initial?.kind === 'section' ? (initial.label ?? '') : '')
  const [when, setWhen] = useState<JumpWhen>(initial?.kind === 'section' ? (initial.when ?? 'section') : 'section')
  const [deviceOpen, setDeviceOpen] = useState(false)
  const sequences = useActionSequencesStore((state) => state.sequences)
  const commandDevices = devices.filter((d) => d.id !== PLAYBACK_CUE_TARGET && d.capability !== CAPABILITIES.midiController && commandsFor(d.capability).length > 0)
  const [editingSequence, setEditingSequence] = useState<ActionSequence | 'new' | null>(null)

  const result: Action | null =
    group === 'section'
      ? sectionOp === 'jump' && label.trim() === ''
        ? null
        : { kind: 'section', op: sectionOp, ...(sectionOp === 'jump' ? { label: label.trim() } : {}), ...(sectionOpJumps(sectionOp) ? { when } : {}) }
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
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!result} onClick={() => result && onSave(result)}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented label="Art" columns={3} value={group} onChange={setGroup} options={allowSequence ? GROUPS : GROUPS.filter((g) => g.value !== 'sequence')} />

        {group === 'show' && (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Show">
            {FIXED_ACTIONS.map(({ id, label: text }) => {
              const chosen = draft?.kind === 'show' && draft.op === id
              return (
                <button key={id} type="button" role="radio" aria-checked={chosen} onClick={() => setDraft({ kind: 'show', op: id })} className={choiceRow(chosen)}>
                  {text}
                </button>
              )
            })}
            <button type="button" role="radio" aria-checked={draft?.kind === 'by-state'} onClick={() => setDraft({ kind: 'by-state', steps })} className={choiceRow(draft?.kind === 'by-state')}>
              Je nach Zustand des Songs
            </button>
            {draft?.kind === 'by-state' && <StepsEditor steps={steps} onChange={setSteps} />}
          </div>
        )}

        {group === 'section' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Abschnitte">
              {SECTION_OPS.map(({ id, label: text }) => (
                <button key={id} type="button" role="radio" aria-checked={sectionOp === id} onClick={() => setSectionOp(id)} className={choiceRow(sectionOp === id)}>
                  {text}
                </button>
              ))}
            </div>
            {sectionOp === 'jump' && (
              <Field label="Abschnitt (Name wie in der Timeline)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="z. B. Chorus" />
            )}
            {sectionOpJumps(sectionOp) && (
              <Segmented
                label="Springen am"
                showLabel
                value={when}
                onChange={setWhen}
                options={[
                  { value: 'bar', label: 'Ende Takt' },
                  { value: 'section', label: 'Ende Abschnitt' },
                ]}
              />
            )}
          </div>
        )}

        {group === 'playback' && (
          <div className="flex flex-col gap-2" role="radiogroup" aria-label="Wiedergabe">
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
            <p className="text-base text-ink">{draft?.kind === 'device' ? describe(draft) : 'Noch kein Befehl gewählt.'}</p>
            <Button className="self-start" onClick={() => setDeviceOpen(true)}>
              {draft?.kind === 'device' ? 'Befehl ändern' : 'Gerät und Befehl wählen'}
            </Button>
            <p className="text-sm text-ink-faint">
              {commandDevices.length === 0
                ? 'Kein Gerät mit fertigen Befehlen eingerichtet (Bühnentechnik) - z. B. Kemper Profiler, NUX MG-30, BOSS RC-500 oder ein Mischpult.'
                : 'Wie ein Cue in der Timeline. Darf jeder auslösen, auch ohne Master zu sein.'}
            </p>
          </div>
        )}
        {group === 'sequence' && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">Mehrere Aktionen nacheinander, mit Pausen in ms, Schlägen oder Takten - für die ganze Band.</p>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="Ablauf">
              {sequences.map((sequence) => {
                const chosen = draft?.kind === 'sequence' && draft.sequenceId === sequence.id
                return (
                  <div key={sequence.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => setDraft({ kind: 'sequence', sequenceId: sequence.id })}
                      className={`flex-1 min-w-0 ${choiceRow(chosen)}`}
                    >
                      {sequence.name}
                    </button>
                    <Button className="flex-shrink-0" onClick={() => setEditingSequence(sequence)}>
                      Bearbeiten
                    </Button>
                  </div>
                )
              })}
            </div>
            <AddRow label="Neuer Ablauf" onClick={() => setEditingSequence('new')} />
          </div>
        )}
      </div>
      {editingSequence && (
        <SequenceDialog
          initial={editingSequence === 'new' ? null : editingSequence}
          onSaved={(sequence) => {
            setDraft({ kind: 'sequence', sequenceId: sequence.id })
            setEditingSequence(null)
          }}
          onClose={() => setEditingSequence(null)}
        />
      )}
      {deviceOpen && (
        <CueDialog
          title="Gerät steuern"
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
  return (
    <div className="flex flex-col gap-2 rounded-container bg-control p-3">
      <p className="text-sm text-ink-muted">Was die Taste tut, hängt davon ab, in welchem Zustand der Song gerade ist (wie in der Statusleiste).</p>
      {SONG_STATES.map(({ id, label }) => (
        <label key={id} className="flex items-center gap-3">
          <span className="w-28 flex-shrink-0 text-base text-ink">{label}</span>
          <select
            value={steps[id]}
            onChange={(e) => onChange({ ...steps, [id]: e.target.value as StepAction })}
            aria-label={`Wenn ${label}`}
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
        Vorlage „Ein-Tasten-Show“
      </Button>
    </div>
  )
}

const WAIT_UNITS: { value: WaitUnit; label: string }[] = [
  { value: 'bars', label: 'Takte' },
  { value: 'beats', label: 'Schläge' },
  { value: 'ms', label: 'ms' },
]
const waitUnitLabel = (unit: WaitUnit, amount: number): string => (unit === 'ms' ? 'ms' : unit === 'bars' ? (amount === 1 ? 'Takt' : 'Takte') : amount === 1 ? 'Schlag' : 'Schläge')

interface DraftStep {
  wait: { amount: number; unit: WaitUnit } | null
  action: Action | null
}

function newSequenceId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** A sequence ("Ablauf", docs/23 §3): a name and its steps, each with the wait before it. */
function SequenceDialog({ initial, onSaved, onClose }: { initial: ActionSequence | null; onSaved: (sequence: ActionSequence) => void; onClose: () => void }) {
  const save = useActionSequencesStore((state) => state.save)
  const remove = useActionSequencesStore((state) => state.remove)
  const confirm = useDialogStore((state) => state.confirm)
  const [name, setName] = useState(initial?.name ?? '')
  const [steps, setSteps] = useState<DraftStep[]>(initial?.steps ?? [{ wait: null, action: null }])
  const complete = name.trim() !== '' && steps.length > 0 && steps.every((step) => step.action)

  const setStep = (index: number, step: DraftStep) => setSteps(steps.map((s, i) => (i === index ? step : s)))

  async function submit() {
    if (!complete) return
    const sequence: ActionSequence = { id: initial?.id ?? newSequenceId(), name: name.trim(), steps: steps.map((step) => ({ wait: step.wait, action: step.action! })) }
    await save(sequence)
    onSaved(sequence)
  }

  return (
    <Dialog
      title={initial ? 'Ablauf bearbeiten' : 'Neuer Ablauf'}
      onClose={onClose}
      actions={
        <>
          {initial ? (
            <Button
              variant="danger"
              onClick={async () => {
                if (!(await confirm(`Ablauf „${initial.name}“ löschen? Knöpfe, die ihn auslösen, tun dann nichts mehr.`, { confirmLabel: 'Löschen', danger: true }))) return
                await remove(initial.id)
                onClose()
              }}
            >
              Löschen
            </Button>
          ) : (
            <Button onClick={onClose}>Abbrechen</Button>
          )}
          <Button variant="primary" disabled={!complete} onClick={() => void submit()}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Solo" />
        {steps.map((step, index) => (
          <div key={index} className="flex flex-col gap-2 rounded-container bg-control p-3">
            {step.wait && (
              <div className="flex flex-col gap-2">
                <Stepper
                  label="Danach warten"
                  value={step.wait.amount}
                  unit={waitUnitLabel(step.wait.unit, step.wait.amount)}
                  min={step.wait.unit === 'ms' ? 0 : 1}
                  max={step.wait.unit === 'ms' ? 10000 : 64}
                  step={step.wait.unit === 'ms' ? 100 : 1}
                  onChange={(amount) => setStep(index, { ...step, wait: { amount, unit: step.wait!.unit } })}
                />
                <Segmented
                  label={`Einheit Schritt ${index + 1}`}
                  value={step.wait.unit}
                  onChange={(unit) => setStep(index, { ...step, wait: { amount: unit === 'ms' ? 500 : 1, unit } })}
                  options={WAIT_UNITS}
                />
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1 min-w-0">
                <ActionField label={`Schritt ${index + 1}`} value={step.action} onChange={(action) => setStep(index, { ...step, action })} allowSequence={false} />
              </div>
              {steps.length > 1 && (
                <Button
                  className="w-12 flex-shrink-0"
                  aria-label={`Schritt ${index + 1} entfernen`}
                  onClick={() => setSteps(steps.filter((_, i) => i !== index).map((s, i) => (i === 0 ? { ...s, wait: null } : s)))}
                >
                  <Icon name="close" />
                </Button>
              )}
            </div>
          </div>
        ))}
        <AddRow label="Schritt hinzufügen" onClick={() => setSteps([...steps, { wait: { amount: 1, unit: 'bars' }, action: null }])} />
        <p className="text-sm text-ink-faint">Schläge und Takte zählen auf dem Raster des laufenden Songs; ohne laufenden Song nach dem Songtempo.</p>
      </div>
    </Dialog>
  )
}
