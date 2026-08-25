import { useRef, useState } from 'react'
import { useEditModeStore } from '../store/useEditModeStore'

const LONG_PRESS_MS = 600

interface EditLockProps {
  /** Fires once the long-press completes and editing actually unlocks - lets AppMenu
   * close itself so the newly-unlocked dashboard is immediately visible. */
  onUnlock?: () => void
}

/**
 * docs/07's "Edit-Lock": unlocking the dashboard takes a deliberate long press, not a tap.
 * On stage a stray finger must not be able to start rearranging widgets. Lives inside
 * AppMenu, not as its own corner button - a corner button sat exactly where a
 * bottom-of-grid widget's resize handle needed to be, and unlocking isn't done often
 * enough to earn permanent screen space anyway (exiting is still one tap: the edit
 * toolbar's own "Fertig" button, shown the whole time editing is unlocked).
 */
export function EditLock({ onUnlock }: EditLockProps) {
  const isEditing = useEditModeStore((state) => state.isEditing)
  const setEditing = useEditModeStore((state) => state.setEditing)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pressing, setPressing] = useState(false)

  function start() {
    if (isEditing) return
    setPressing(true)
    timer.current = setTimeout(() => {
      setEditing(true)
      setPressing(false)
      onUnlock?.()
    }, LONG_PRESS_MS)
  }

  function cancel() {
    setPressing(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  if (isEditing) return null

  return (
    <button
      type="button"
      title="Zum Entsperren gedrückt halten"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`flex h-12 w-full items-center justify-between rounded-sb px-4 text-base transition-colors ${
        pressing ? 'bg-accent text-accent-ink' : 'bg-control text-ink-soft hover:bg-control-hover'
      }`}
    >
      Bearbeiten
      <span className="text-xl leading-none">🔒</span>
    </button>
  )
}
