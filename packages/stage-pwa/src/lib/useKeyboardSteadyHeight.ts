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
 * end of typing takes the real height again.
 */
export function useKeyboardSteadyHeight(width: number, height: number): number {
  const held = useRef({ width, height })
  const [, recheck] = useReducer((n: number) => n + 1, 0)
  if (width !== held.current.width || height >= held.current.height || !isTyping()) held.current = { width, height }

  useEffect(() => {
    // After a field loses focus, document.activeElement only settles a moment later.
    const onFocusOut = () => setTimeout(recheck, 0)
    document.addEventListener('focusout', onFocusOut)
    return () => document.removeEventListener('focusout', onFocusOut)
  }, [])

  return held.current.height
}
