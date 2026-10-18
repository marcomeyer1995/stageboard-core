import { useState } from 'react'
import { CAPABILITIES, PLAYBACK_CUE_TARGET } from 'shared-types'
import { describeAction, PLAYBACK_OPS, SECTION_OPS, sectionOpJumps, type Action, type SectionOp } from '../lib/actions'
import { describeCue } from '../lib/deviceCommands'
import { FIXED_ACTIONS, ONE_BUTTON_SHOW, SONG_STATES, STEP_CHOICES, STEP_LABEL, type SongState, type StepAction } from '../lib/keybindings'
import type { JumpWhen } from '../lib/showSections'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { CueDialog } from './timeline/CueDialog'
import { Button, Dialog, Field, Segmented, choiceRow } from './ui'
import { INPUT_FREE } from './ui/styles'

type Group = 'show' | 'section' | 'playback' | 'device'

const GROUPS: { value: Group; label: string }[] = [
  { value: 'show', label: 'Show' },
  { value: 'section', label: 'Abschnitte' },
  { value: 'playback', label: 'Wiedergabe' },
  { value: 'device', label: 'Gerät' },
]

function groupOf(action: Action | null): Group {
  if (!action || action.kind === 'show' || action.kind === 'by-state') return 'show'
  return action.kind
}

/** An action in words, with the device's name for a device command. */
export function useDescribeAction(): (action: Action) => string {
  const devices = useLogicalDevicesStore((state) => state.devices)
  return (action) => {
    if (action.kind !== 'device') return describeAction(action)
    const device = devices.find((d) => d.id === action.targetLogicalDeviceId)
    return `${device?.name ?? 'Gerät fehlt'}: ${describeCue(action, device?.capability)}`
  }
}

/**
 * One action as a row with "Ändern" - the same everywhere an action is chosen (docs/23 §7): pedal
 * keys now, MIDI controllers and widget buttons next. `optional`: "nichts" is a choice too.
 */
export function ActionField({ label, value, onChange, optional = false }: { label: string; value: Action | null; onChange: (action: Action | null) => void; optional?: boolean }) {
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
export function ActionDialog({ title, initial, onSave, onClose }: { title: string; initial: Action | null; onSave: (action: Action) => void; onClose: () => void }) {
  const devices = useLogicalDevicesStore((state) => state.devices)
  const describe = useDescribeAction()
  const [group, setGroup] = useState<Group>(groupOf(initial))
  const [draft, setDraft] = useState<Action | null>(initial)
  const [steps, setSteps] = useState<Record<SongState, StepAction>>(initial?.kind === 'by-state' ? initial.steps : ONE_BUTTON_SHOW)
  const [sectionOp, setSectionOp] = useState<SectionOp>(initial?.kind === 'section' ? initial.op : 'jump')
  const [label, setLabel] = useState(initial?.kind === 'section' ? (initial.label ?? '') : '')
  const [when, setWhen] = useState<JumpWhen>(initial?.kind === 'section' ? (initial.when ?? 'section') : 'section')
  const [deviceOpen, setDeviceOpen] = useState(false)

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
        <Segmented label="Art" value={group} onChange={setGroup} options={GROUPS} />

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
            <p className="text-sm text-ink-faint">Wie ein Cue in der Timeline. Darf jeder auslösen, auch ohne Master zu sein.</p>
          </div>
        )}
      </div>
      {deviceOpen && (
        <CueDialog
          title="Gerät steuern"
          devices={devices.filter((d) => d.id !== PLAYBACK_CUE_TARGET && d.capability !== CAPABILITIES.midiController)}
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
