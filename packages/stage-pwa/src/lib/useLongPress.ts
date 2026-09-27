import { useEffect, useRef, useState, type PointerEvent } from 'react'

/** How long a press has to be held, ms - short enough to feel responsive, long enough that a
 * tap or the start of a scroll never triggers it. */
export const LONG_PRESS_MS = 500
/** Movement that turns a press into a scroll instead, px. */
const MOVE_TOLERANCE_PX = 10

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent) => void
  onPointerUp: () => void
  onPointerLeave: () => void
  onPointerCancel: () => void
  onContextMenu: (event: { preventDefault: () => void }) => void
}

/**
 * Long press on an element (the Live-Queue rows' context menu). Fires once after LONG_PRESS_MS
 * unless the finger lifts or moves - a moving finger is scrolling the list. The browser's own
 * long-press context menu is suppressed, and on browsers that raise `contextmenu` for a long
 * press (or a right click with a mouse) that event opens it too. `pressing` is true while the
 * press is held, for visual feedback.
 */
export function useLongPress(onLongPress: () => void, enabled = true): [LongPressHandlers, boolean] {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef<{ x: number; y: number } | null>(null)
  const fired = useRef(false)
  const [pressing, setPressing] = useState(false)

  function clear() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    origin.current = null
    setPressing(false)
  }

  useEffect(() => clear, [])

  function fire() {
    clear()
    fired.current = true
    onLongPress()
  }

  return [
    {
      onPointerDown: (event) => {
        // Touch and the primary mouse button; a right click comes in as `contextmenu` below.
        if (!enabled || event.button !== 0) return
        fired.current = false
        origin.current = { x: event.clientX, y: event.clientY }
        setPressing(true)
        timer.current = setTimeout(fire, LONG_PRESS_MS)
      },
      onPointerMove: (event) => {
        if (!origin.current) return
        if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > MOVE_TOLERANCE_PX) clear()
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (event) => {
        if (!enabled) return
        event.preventDefault()
        // The timer usually got there first on touch; don't open twice.
        if (!fired.current) fire()
      },
    },
    pressing,
  ]
}
