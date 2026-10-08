import { useEffect, useState } from 'react'
import {
  bindingForKey,
  describeAction,
  FIXED_ACTIONS,
  isBindableKey,
  keyLabel,
  ONE_BUTTON_SHOW,
  SONG_STATES,
  STEP_CHOICES,
  STEP_LABEL,
  type FixedAction,
  type KeyAction,
  type KeyBinding,
  type SongState,
  type StepAction,
} from '../lib/keybindings'
import { footswitchCapture } from '../lib/useFootswitch'
import { useKeybindingsStore } from '../store/useKeybindingsStore'
import { Icon } from './Icon'
import { AddRow, Button, Dialog, MENU_ROW } from './ui'
import { INPUT_FREE, SELECTED } from './ui/styles'

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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">
        Bluetooth-Pedal (z. B. AirTurn, PageFlip) wie eine Tastatur koppeln, dann hier Zuordnungen anlegen. Wirkt auf den
        Dashboards - im Gig-Modus nur am Master-Gerät, wie die Knöpfe auf dem Bildschirm.
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
                {describeAction(binding.action)}
              </button>
              <button
                type="button"
                onClick={() => remove(binding.key)}
                aria-label={`Zuordnung für ${keyLabel(binding.key)} löschen`}
                className="flex h-form w-12 flex-shrink-0 items-center justify-center rounded-control text-ink-muted [@media(hover:hover)]:hover:bg-control-hover [@media(hover:hover)]:hover:text-ink"
              >
                <Icon name="close" />
              </button>
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

type Choice = FixedAction | 'by-state'

/** The step-by-step popup: 1. press the pedal, 2. choose what it does, 3. save. */
function KeyMappingDialog({ initial, onSave, onClose }: { initial: KeyBinding | null; onSave: (binding: KeyBinding) => void; onClose: () => void }) {
  const bindings = useKeybindingsStore((state) => state.bindings)
  const [key, setKey] = useState<string | null>(initial?.key ?? null)
  const [choice, setChoice] = useState<Choice | null>(initial ? (initial.action.kind === 'fixed' ? initial.action.action : 'by-state') : null)
  const [steps, setSteps] = useState<Record<SongState, StepAction>>(initial?.action.kind === 'by-state' ? initial.action.steps : ONE_BUTTON_SHOW)
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
  const action: KeyAction | null = choice === null ? null : choice === 'by-state' ? { kind: 'by-state', steps } : { kind: 'fixed', action: choice }
  const option = (selected: boolean) => `${MENU_ROW} ${selected ? SELECTED : 'text-ink'}`

  return (
    <Dialog
      title={initial ? 'Zuordnung ändern' : 'Neue Zuordnung'}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="primary" disabled={!key || !action} onClick={() => key && action && onSave({ key, action })}>
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
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base text-ink-soft">Taste:</span>
              <span className="rounded-control bg-control-strong px-3 py-2 text-base font-bold text-ink">{keyLabel(key)}</span>
              <Button onClick={() => setKey(null)}>Andere Taste</Button>
            </div>
            {takenBy && (
              <p className="text-sm text-warn">
                {keyLabel(key)} ist schon belegt („{describeAction(takenBy.action)}“) - beim Speichern wird das ersetzt.
              </p>
            )}

            <fieldset className="flex flex-col gap-2" role="radiogroup" aria-label="Was soll passieren?">
              <legend className="mb-2 text-base font-semibold text-ink">Was soll passieren?</legend>
              {FIXED_ACTIONS.map(({ id, label }) => (
                <button key={id} type="button" role="radio" aria-checked={choice === id} onClick={() => setChoice(id)} className={option(choice === id)}>
                  {label}
                </button>
              ))}
              <button type="button" role="radio" aria-checked={choice === 'by-state'} onClick={() => setChoice('by-state')} className={option(choice === 'by-state')}>
                Je nach Zustand des Songs
              </button>
            </fieldset>

            {choice === 'by-state' && (
              <div className="flex flex-col gap-2 rounded-container bg-control p-3">
                <p className="text-sm text-ink-muted">Was die Taste tut, hängt davon ab, in welchem Zustand der Song gerade ist (wie in der Statusleiste).</p>
                {SONG_STATES.map(({ id, label }) => (
                  <label key={id} className="flex items-center gap-3">
                    <span className="w-28 flex-shrink-0 text-base text-ink">{label}</span>
                    <select
                      value={steps[id]}
                      onChange={(e) => setSteps({ ...steps, [id]: e.target.value as StepAction })}
                      aria-label={`Wenn ${label}`}
                      className={`min-h-form min-w-0 flex-1 min-w-0 px-3 text-base ${INPUT_FREE}`}
                    >
                      {STEP_CHOICES[id].map((step) => (
                        <option key={step} value={step}>
                          {STEP_LABEL[step]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => setSteps(ONE_BUTTON_SHOW)}
                  className="min-h-form self-start rounded-control bg-control-strong px-4 text-base text-ink [@media(hover:hover)]:hover:bg-control-strong-hover"
                >
                  Vorlage „Ein-Tasten-Show“
                </button>
              </div>
            )}
          </>
        )}

    </Dialog>
  )
}
