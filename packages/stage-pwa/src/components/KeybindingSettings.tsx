import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from '../lib/backNavigation'
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
            <li key={binding.key} className="flex items-center gap-2 rounded-sb-sm bg-control px-3 py-2">
              <span className="flex-shrink-0 rounded-sb-sm bg-control-strong px-3 py-2 text-sm font-bold text-ink">{keyLabel(binding.key)}</span>
              <button
                type="button"
                onClick={() => setEditing(binding)}
                className="min-h-12 min-w-0 flex-1 rounded-sb-sm px-2 text-left text-base text-ink hover:bg-control-hover"
              >
                {describeAction(binding.action)}
              </button>
              <button
                type="button"
                onClick={() => remove(binding.key)}
                aria-label={`Zuordnung für ${keyLabel(binding.key)} löschen`}
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-sb-sm text-ink-muted hover:bg-control-hover hover:text-ink"
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setEditing('new')}
        className="min-h-12 self-start rounded-sb-sm bg-accent px-4 font-bold text-accent-ink hover:bg-accent-hover"
      >
        + Neue Zuordnung
      </button>
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
  useBackHandler(onClose)

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
  const option = (selected: boolean) =>
    `min-h-12 rounded-sb-sm px-4 text-left text-base ${selected ? 'bg-accent font-bold text-accent-ink' : 'bg-control text-ink hover:bg-control-hover'}`

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={initial ? 'Zuordnung ändern' : 'Neue Zuordnung'}
        className="flex max-h-[90dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-sb border border-line bg-surface p-4 shadow-sb"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-ink">{initial ? 'Zuordnung ändern' : 'Neue Zuordnung'}</h2>

        {listening ? (
          <div className="flex flex-col items-center gap-3 rounded-sb bg-control p-6 text-center">
            <span className="text-2xl font-bold text-accent">Jetzt Pedal drücken …</span>
            <span className="text-sm text-ink-muted">oder eine Taste der Tastatur. Esc bricht ab.</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base text-ink-soft">Taste:</span>
              <span className="rounded-sb-sm bg-control-strong px-3 py-2 text-base font-bold text-ink">{keyLabel(key)}</span>
              <button type="button" onClick={() => setKey(null)} className="min-h-12 rounded-sb-sm bg-control px-4 text-sm text-ink-soft hover:bg-control-hover">
                Andere Taste
              </button>
            </div>
            {takenBy && (
              <p className="text-sm text-amber-500">
                {keyLabel(key)} ist schon belegt („{describeAction(takenBy.action)}“) - beim Speichern wird das ersetzt.
              </p>
            )}

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-base font-semibold text-ink">Was soll passieren?</legend>
              {FIXED_ACTIONS.map(({ id, label }) => (
                <button key={id} type="button" aria-pressed={choice === id} onClick={() => setChoice(id)} className={option(choice === id)}>
                  {label}
                </button>
              ))}
              <button type="button" aria-pressed={choice === 'by-state'} onClick={() => setChoice('by-state')} className={option(choice === 'by-state')}>
                Je nach Zustand des Songs
              </button>
            </fieldset>

            {choice === 'by-state' && (
              <div className="flex flex-col gap-2 rounded-sb bg-control p-3">
                <p className="text-sm text-ink-muted">Was die Taste tut, hängt davon ab, in welchem Zustand der Song gerade ist (wie in der Statusleiste).</p>
                {SONG_STATES.map(({ id, label }) => (
                  <label key={id} className="flex items-center gap-3">
                    <span className="w-28 flex-shrink-0 text-base text-ink">{label}</span>
                    <select
                      value={steps[id]}
                      onChange={(e) => setSteps({ ...steps, [id]: e.target.value as StepAction })}
                      aria-label={`Wenn ${label}`}
                      className="h-12 min-w-0 flex-1 rounded-sb-sm bg-control-strong px-3 text-base text-ink"
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
                  className="min-h-12 self-start rounded-sb-sm bg-control-strong px-4 text-sm text-ink hover:bg-control-strong-hover"
                >
                  Vorlage „Ein-Tasten-Show“
                </button>
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-12 rounded-sb-sm bg-control px-4 text-base text-ink-soft hover:bg-control-hover">
            Abbrechen
          </button>
          <button
            type="button"
            disabled={!key || !action}
            onClick={() => key && action && onSave({ key, action })}
            className="min-h-12 rounded-sb-sm bg-accent px-6 text-base font-bold text-accent-ink hover:bg-accent-hover disabled:opacity-40"
          >
            Speichern
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
