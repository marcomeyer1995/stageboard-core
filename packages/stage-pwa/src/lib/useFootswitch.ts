import { useEffect, useRef } from 'react'
import { actionForKey, isTypingTarget, PROMPTER_SCROLL_EVENT, type FootswitchAction, type PrompterScrollDetail } from './keybindings'
import { useShowMode } from './showMode'
import { useKeybindingsStore } from '../store/useKeybindingsStore'

/** Set while KeybindingSettings waits for "press the pedal now" - the key is assigned there,
 * not executed. */
export const footswitchCapture = { active: false }

/**
 * Mounted once in App.tsx (#27): turns pedal/keyboard keys into show actions while a dashboard
 * is on screen (never in the editor or System, where keys have their own meaning, and never
 * while typing into a field). Same rules as the on-screen buttons: in Gig mode only the master
 * acts (useShowMode().canControl).
 */
export function useFootswitch(active: boolean): void {
  const show = useShowMode()
  const bindings = useKeybindingsStore((state) => state.bindings)
  const latest = useRef({ show, bindings })
  latest.current = { show, bindings }

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (footswitchCapture.active || event.repeat || isTypingTarget(event.target)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const action = actionForKey(latest.current.bindings, event.key)
      if (!action) return
      event.preventDefault()
      run(action, latest.current.show)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])
}

function run(action: FootswitchAction, show: ReturnType<typeof useShowMode>): void {
  if (action === 'prompter-down' || action === 'prompter-up') {
    window.dispatchEvent(new CustomEvent<PrompterScrollDetail>(PROMPTER_SCROLL_EVENT, { detail: { direction: action === 'prompter-down' ? 1 : -1 } }))
    return
  }
  if (!show.canControl) return
  if (action === 'next') void show.next()
  else if (action === 'previous') void show.previous()
  else if (action === 'stop') void show.stop()
  else if (action === 'play-pause') void (show.playbackStatus === 'playing' ? show.pause() : show.play())
}
