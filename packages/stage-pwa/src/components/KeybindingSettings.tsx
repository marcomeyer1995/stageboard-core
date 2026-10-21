import { useEffect, useState } from 'react'
import type { Behavior } from '../lib/actions'
import { bindingForKey, isBindableKey, keyLabel, type KeyBinding } from '../lib/keybindings'
import { footswitchCapture } from '../lib/useFootswitch'
import { useKeybindingsStore } from '../store/useKeybindingsStore'
import { BehaviorEditor, useDescribeBehavior } from './BehaviorEditor'
import { Icon } from './Icon'
import { AddRow, Button, Dialog } from './ui'

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

/** The step-by-step popup (docs/23 §4a): 1. press the pedal, 2. how it behaves, 3. what it does. */
function KeyMappingDialog({ initial, onSave, onClose }: { initial: KeyBinding | null; onSave: (binding: KeyBinding) => void; onClose: () => void }) {
  const bindings = useKeybindingsStore((state) => state.bindings)
  const describeMapping = useDescribeBehavior()
  const [key, setKey] = useState<string | null>(initial?.key ?? null)
  const [behavior, setBehavior] = useState<Behavior | null>(initial?.behavior ?? null)
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
          <BehaviorEditor initial={initial?.behavior ?? null} onChange={setBehavior} />
        </div>
      )}
    </Dialog>
  )
}
