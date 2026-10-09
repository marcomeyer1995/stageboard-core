import { useEffect, useRef } from 'react'
import { clickTimeline } from './beatGrid'
import {
  bindingForKey,
  isTypingTarget,
  PROMPTER_SCROLL_EVENT,
  songStateFor,
  type FixedAction,
  type KeyAction,
  type PrompterScrollDetail,
  type SongState,
  type StepAction,
} from './keybindings'
import { adjustedBpm, beatAt } from './metronome'
import { useShowMode } from './showMode'
import { useKeybindingsStore } from '../store/useKeybindingsStore'

/** Set while the mapping popup waits for "press the pedal now" - the key is captured there, not
 * executed. */
export const footswitchCapture = { active: false }

type Show = ReturnType<typeof useShowMode>

/** Whether the song is still in its count-in bars - the same reading as the status bar's. */
export function isCountingIn(show: Show): boolean {
  if (show.playbackStatus !== 'playing' || show.elapsedMs === null) return false
  if (show.elapsedMs < 0) return true
  const { currentVariant, currentSong } = show.queue
  const song = currentVariant ?? currentSong
  if (!song) return false
  const countInBars = currentVariant?.countInEnabled ? (currentVariant.countInBars ?? 0) : 0
  const timeline = clickTimeline({ beatGrid: currentVariant?.beatGrid, bpm: adjustedBpm(song.bpm, show.liveTempoAdjustPercent), timeSignature: song.timeSignature, countInBars })
  return beatAt(show.elapsedMs, timeline)?.isCountIn === true
}

export function currentSongState(show: Show): SongState {
  return songStateFor({ playbackStatus: show.playbackStatus, isCountIn: isCountingIn(show), trackEnded: show.trackEnded })
}

/**
 * Mounted once in App.tsx (#27): turns pedal/keyboard keys into show actions while a dashboard
 * is on screen (never in the editor or System, where keys have their own meaning, and never
 * while typing into a field). Same rules as the on-screen buttons: in Gig mode only the master
 * acts (useShowMode().canControl). A state-dependent key looks at the song's state at the moment
 * of the press.
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
      // A dialog or the ☰ menu is open: the pedal must not run the show behind it - and Enter/Space
      // would also press the focused button there (#394 review).
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const binding = bindingForKey(latest.current.bindings, event.key)
      if (!binding) return
      event.preventDefault()
      void runKeyAction(binding.action, latest.current.show)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])
}

export async function runKeyAction(action: KeyAction, show: Show): Promise<void> {
  if (action.kind === 'fixed') {
    await runFixed(action.action, show)
    return
  }
  await runStep(action.steps[currentSongState(show)], show)
}

async function runFixed(action: FixedAction, show: Show): Promise<void> {
  if (action === 'prompter-down' || action === 'prompter-up') {
    window.dispatchEvent(new CustomEvent<PrompterScrollDetail>(PROMPTER_SCROLL_EVENT, { detail: { direction: action === 'prompter-down' ? 1 : -1 } }))
    return
  }
  if (!show.canControl) return
  if (action === 'next') await show.next()
  else if (action === 'previous') await show.previous()
  else if (action === 'stop') await show.stop()
  else if (action === 'play-pause') await (show.playbackStatus === 'playing' ? show.pause() : show.play())
}

async function runStep(step: StepAction, show: Show): Promise<void> {
  if (step === 'none' || !show.canControl) return
  if (step === 'play' || step === 'resume') await show.play()
  else if (step === 'pause') await show.pause()
  else if (step === 'stop') await show.stop()
  else if (step === 'next') await show.next()
  else if (step === 'stop-next') {
    // Stop first, so the song is logged as played, then arm the next one.
    await show.stop()
    await show.next()
  } else if (step === 'next-play') {
    // At the end of the setlist there is no next song - playing would restart the one that just
    // ended (#394 review).
    if (!show.queue.nextEntry) return
    await show.next()
    // One task later, like the auto-advance: lets the audio driver load the new entry's track
    // before Play needs it.
    setTimeout(() => void show.play(), 0)
  }
}
