import { useEffect, useRef } from 'react'
import { bindingForKey, isTypingTarget } from './keybindings'
import { trackLatestShow, type Show } from './runAction'
import { pressTrigger, releaseTrigger } from './triggerPress'
import { useShowMode } from './showMode'
import { useKeybindingsStore } from '../store/useKeybindingsStore'

export { currentSongState, isCountingIn } from './runAction'

/** Set while the mapping popup waits for "press the pedal now" - the key is captured there, not
 * executed. */
export const footswitchCapture = { active: false }

function blocked(event: KeyboardEvent): boolean {
  if (footswitchCapture.active || isTypingTarget(event.target)) return true
  // A dialog or the ☰ menu is open: the pedal must not run the show behind it - and Enter/Space
  // would also press the focused button there (#394 review).
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true
  return event.ctrlKey || event.metaKey || event.altKey
}

/** What a key press does (docs/23 §4a) - the shared trigger logic (triggerPress.ts). */
export function pressKey(key: string, show: Show): boolean {
  const binding = bindingForKey(useKeybindingsStore.getState().bindings, key)
  if (!binding) return false
  void pressTrigger(`key:${key}`, binding.behavior, show)
  return true
}

/** What letting go of a key does - only a tastend key with an action on release. */
export function releaseKey(key: string, show: Show): boolean {
  const binding = bindingForKey(useKeybindingsStore.getState().bindings, key)
  if (!binding) return false
  return releaseTrigger(`key:${key}`, binding.behavior, show) !== null
}

/**
 * Mounted once in App.tsx (#27, docs/23): turns pedal/keyboard keys into actions while a dashboard
 * is on screen (never in the editor or System, where keys have their own meaning, and never while
 * typing into a field). The rights are runAction's: show control only where the musician may
 * control the show, device commands from anyone. A state-dependent key looks at the song's state
 * at the moment of the press.
 */
export function useFootswitch(active: boolean): void {
  const show = useShowMode()
  const latest = useRef(show)
  latest.current = show
  trackLatestShow(show)

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || blocked(event)) return
      if (pressKey(event.key, latest.current)) event.preventDefault()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (blocked(event)) return
      if (releaseKey(event.key, latest.current)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [active])
}
