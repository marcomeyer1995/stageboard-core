import { useEffect, useRef } from 'react'
import { bindingForKey, isTypingTarget } from './keybindings'
import { releaseDelayMs, runAction, type Show } from './runAction'
import { useShowMode } from './showMode'
import { useKeybindingsStore } from '../store/useKeybindingsStore'

export { currentSongState, isCountingIn } from './runAction'

/** Set while the mapping popup waits for "press the pedal now" - the key is captured there, not
 * executed. */
export const footswitchCapture = { active: false }

/** Latching keys that are "on" right now (docs/23 §4a) - per key, on this device. */
const latched = new Set<string>()
/** Timed releases waiting, per key - a new press starts its own. */
const pendingReleases = new Map<string, ReturnType<typeof setTimeout>>()

function blocked(event: KeyboardEvent): boolean {
  if (footswitchCapture.active || isTypingTarget(event.target)) return true
  // A dialog or the ☰ menu is open: the pedal must not run the show behind it - and Enter/Space
  // would also press the focused button there (#394 review).
  if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return true
  return event.ctrlKey || event.metaKey || event.altKey
}

/** What a key press does (docs/23 §4a): the press action, a timed release, or the latch toggled. */
export function pressKey(key: string, show: Show): boolean {
  const binding = bindingForKey(useKeybindingsStore.getState().bindings, key)
  if (!binding) return false
  const { behavior } = binding
  if (behavior.kind === 'latching') {
    const on = !latched.has(key)
    if (on) latched.add(key)
    else latched.delete(key)
    void runAction(on ? behavior.on : behavior.off, show)
    return true
  }
  void runAction(behavior.press, show)
  const { release } = behavior
  if (release.kind === 'after') {
    const waiting = pendingReleases.get(key)
    if (waiting) clearTimeout(waiting)
    pendingReleases.set(
      key,
      setTimeout(() => {
        pendingReleases.delete(key)
        void runAction(release.action, show)
      }, releaseDelayMs(release, show)),
    )
  }
  return true
}

/** What letting go of a key does - only a momentary key with an action on release. */
export function releaseKey(key: string, show: Show): boolean {
  const binding = bindingForKey(useKeybindingsStore.getState().bindings, key)
  if (!binding || binding.behavior.kind !== 'momentary' || binding.behavior.release.kind !== 'on-release') return false
  void runAction(binding.behavior.release.action, show)
  return true
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
