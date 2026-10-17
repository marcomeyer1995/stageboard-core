import { useEffect, useReducer, useRef } from 'react'

/** A text field has the focus - on a touchscreen, the on-screen keyboard is up. */
export function isTyping(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(el.type)
  return el instanceof HTMLElement && el.isContentEditable
}

/**
 * The height a dashboard lays out with: the measured one, except that it never shrinks while
 * someone types (Marco, 2026-10-16: the keyboard of the "Neues Dashboard" name dialog squeezed
 * every widget behind it). Android makes the whole page smaller for the keyboard; the grid keeps
 * its size instead and the keyboard simply covers its lower part. A new width (rotation) or the
 * end of typing takes the real height again - but only once the keyboard has had time to slide
 * away: "Abbrechen" ends typing at once, while the page is still short for a moment (Marco,
 * 2026-10-16: the widgets still shrank for an instant).
 */
/** How long after typing ends a smaller height still counts as the keyboard sliding away. */
export const KEYBOARD_CLOSE_MS = 1000

export function useKeyboardSteadyHeight(width: number, height: number): number {
  const held = useRef({ width, height })
  const typingEndedAt = useRef(0)
  const [, recheck] = useReducer((n: number) => n + 1, 0)
  const typing = isTyping()
  const keyboardClosing = !typing && Date.now() - typingEndedAt.current < KEYBOARD_CLOSE_MS
  // A real new width (rotation) is whole pixels away. Not a fraction: the first measurement comes
  // from clientWidth (rounded, 601), the observer's later ones are exact (600.94) - the first
  // keyboard after a dashboard switch took that for a rotation and shrank the widgets (Marco,
  // 2026-10-17: only the first time).
  const newWidth = Math.abs(width - held.current.width) >= 1
  if (newWidth || height >= held.current.height || (!typing && !keyboardClosing)) held.current = { width, height }

  useEffect(() => {
    const onFocusOut = () => {
      typingEndedAt.current = Date.now()
      // After a field loses focus, document.activeElement only settles a moment later; once the
      // keyboard had its time, a height that is still smaller is real and taken.
      setTimeout(recheck, 0)
      setTimeout(recheck, KEYBOARD_CLOSE_MS + 50)
    }
    document.addEventListener('focusout', onFocusOut)
    return () => document.removeEventListener('focusout', onFocusOut)
  }, [])

  return held.current.height
}
