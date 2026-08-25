import { useRef, useState } from 'react'
import { useEditModeStore } from '../store/useEditModeStore'

const LONG_PRESS_MS = 600

/**
 * docs/07's "Edit-Lock": unlocking the dashboard takes a deliberate long press, not a tap.
 * On stage a stray finger must not be able to start rearranging widgets.
 */
export function EditLock() {
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
      className={`rounded px-3 py-1 text-xs transition-colors ${
        pressing ? 'bg-accent text-black' : 'bg-control text-ink-soft hover:bg-control-hover'
      }`}
    >
      🔒
    </button>
  )
}
