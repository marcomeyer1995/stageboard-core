import { useEffect, useState } from 'react'
import type { Behavior } from '../lib/actions'
import { bindingForKey, isBindableKey, keyLabel, type KeyBinding } from '../lib/keybindings'
import { footswitchCapture } from '../lib/useFootswitch'
import { useKeybindingsStore } from '../store/useKeybindingsStore'
import { BehaviorEditor, useDescribeBehavior } from './BehaviorEditor'
import { Icon } from './Icon'
import { AddRow, Button, Dialog } from './ui'
import { useTranslation } from 'react-i18next'

/**
 * Foot switch mapping (#27): an empty list to start with - each mapping is set up step by step in
 * a popup (press the pedal, choose what it does). A key either has one fixed meaning or one per
 * song state ("Je nach Zustand"), so a single pedal can run the whole show.
 */
export function KeybindingSettings() {
  const { t } = useTranslation('actions')
  const bindings = useKeybindingsStore((state) => state.bindings)
  const save = useKeybindingsStore((state) => state.save)
  const remove = useKeybindingsStore((state) => state.remove)
  const [editing, setEditing] = useState<KeyBinding | 'new' | null>(null)
  const describeMapping = useDescribeBehavior()

  return (
    <div className="flex flex-col gap-3">
      {bindings.length === 0 ? (
        <p className="text-base text-ink-soft">{t('keys.none')}</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={t('keys.list')}>
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
              <Button className="w-12 flex-shrink-0" onClick={() => remove(binding.key)} aria-label={t('keys.delete', { key: keyLabel(binding.key) })}>
                <Icon name="close" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <AddRow label={t('keys.new')} onClick={() => setEditing('new')} />
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
  const { t } = useTranslation('actions')
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
      title={initial ? t('keys.change') : t('keys.new')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" disabled={!key || !behavior} onClick={() => key && behavior && onSave({ key, behavior })}>
            {t('save')}
          </Button>
        </>
      }
    >
      {listening ? (
        <div className="flex flex-col items-center gap-3 rounded-container bg-control p-6 text-center">
          <span className="text-2xl font-bold text-accent">{t('keys.press')}</span>
          <span className="text-sm text-ink-muted">{t('keys.orKey')}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base text-ink-soft">{t('keys.key')}</span>
            <span className="rounded-control bg-control-strong px-3 py-2 text-base font-bold text-ink">{keyLabel(key)}</span>
            <Button onClick={() => setKey(null)}>{t('keys.other')}</Button>
          </div>
          {takenBy && (
            <p className="text-sm text-warn">
              {t('keys.taken', { key: keyLabel(key), mapping: describeMapping(takenBy.behavior) })}
            </p>
          )}
          <BehaviorEditor initial={initial?.behavior ?? null} onChange={setBehavior} />
        </div>
      )}
    </Dialog>
  )
}
