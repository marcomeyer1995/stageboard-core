import { isSongEntry } from 'shared-types'
import type { Action, Release } from './actions'
import { needsShowControl } from './actions'
import { clickTimeline, type ClickTimeline } from './beatGrid'
import { fireDeviceAction } from './deviceAction'
import { songDurationMs } from './entryDuration'
import { PROMPTER_SCROLL_EVENT, songStateFor, type FixedAction, type PrompterScrollDetail, type SongState, type StepAction } from './keybindings'
import { adjustedBpm, beatAt, effectiveClickEnabled } from './metronome'
import { cancelSectionJump, queueSectionJump, setSectionLoop } from './sectionJump'
import type { useShowMode } from './showMode'
import { sectionIndexAt, showSections, type ShowSection } from './showSections'
import { useShowStateStore } from '../store/useShowStateStore'

export type Show = ReturnType<typeof useShowMode>

/** The current song's click grid and its sections (#479) - what section actions work on. */
export function songSectionsNow(show: Show): { timeline: ClickTimeline; sections: ShowSection[] } | null {
  const { currentEntry, currentSong, currentVariant } = show.queue
  const song = currentVariant ?? currentSong
  if (!song) return null
  const timeline = clickTimeline({
    beatGrid: currentVariant?.beatGrid,
    bpm: adjustedBpm(song.bpm, show.liveTempoAdjustPercent),
    timeSignature: song.timeSignature,
    countInBars: currentVariant?.countInEnabled ? (currentVariant.countInBars ?? 0) : 0,
  })
  const durationMs = currentEntry && isSongEntry(currentEntry) ? (songDurationMs(currentEntry, currentVariant, show.trackOverride)?.ms ?? null) : null
  const content = currentVariant?.chordProContent ?? currentSong?.chordProContent ?? ''
  return { timeline, sections: showSections(content, timeline, durationMs) }
}

/** How long a timed release waits (docs/23 §4a): beats and bars at the song's tempo where it plays now. */
export function releaseDelayMs(release: Extract<Release, { kind: 'after' }>, show: Show): number {
  if (release.unit === 'ms') return release.amount
  const now = songSectionsNow(show)
  if (!now) return release.amount * (release.unit === 'bars' ? 2000 : 500)
  const beat = now.timeline.beatAtOrBefore(Math.max(0, show.elapsedMs ?? 0))
  const beatMs = now.timeline.periodAfter(beat)
  const perBar = Number(now.timeline.timeSignatureAt(beat).split('/')[0]) || 4
  return release.amount * beatMs * (release.unit === 'bars' ? perBar : 1)
}

/**
 * Runs an action (docs/23) - for a pedal now, a MIDI controller and widget buttons next. Respects
 * the rights (§5a): show, section and playback actions only where the musician may control the
 * show (the master in Gig) - never handed on to the master; device commands from anyone; paging
 * the prompter always. Returns a short reason when nothing happened, else null.
 */
export async function runAction(action: Action, show: Show): Promise<string | null> {
  if (needsShowControl(action) && !show.canControl) return 'Nur der Master steuert die Show'
  switch (action.kind) {
    case 'show':
      await runShow(action.op, show)
      return null
    case 'by-state':
      await runStep(action.steps[currentSongState(show)], show)
      return null
    case 'section':
      return runSection(action, show)
    case 'playback':
      return runPlayback(action.op, show)
    case 'device':
      return fireDeviceAction(action.targetLogicalDeviceId, action.type, action.payload)
  }
}

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

async function runShow(op: FixedAction, show: Show): Promise<void> {
  if (op === 'prompter-down' || op === 'prompter-up') {
    window.dispatchEvent(new CustomEvent<PrompterScrollDetail>(PROMPTER_SCROLL_EVENT, { detail: { direction: op === 'prompter-down' ? 1 : -1 } }))
    return
  }
  if (op === 'next') await show.next()
  else if (op === 'previous') await show.previous()
  else if (op === 'stop') await show.stop()
  else if (op === 'play-pause') await (show.playbackStatus === 'playing' ? show.pause() : show.play())
}

export async function runStep(step: StepAction, show: Show): Promise<void> {
  if (step === 'none') return
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

async function runSection(action: Extract<Action, { kind: 'section' }>, show: Show): Promise<string | null> {
  if (action.op === 'cancel') {
    await cancelSectionJump()
    return null
  }
  if (action.op === 'loop-off') {
    await setSectionLoop(null)
    return null
  }
  const now = songSectionsNow(show)
  if (!now || now.sections.length === 0) return 'Keine Abschnitte im Song'
  const elapsed = show.elapsedMs ?? 0
  const index = sectionIndexAt(now.sections, elapsed)
  const current = now.sections[index]
  if (action.op === 'loop-on' || action.op === 'loop-toggle') {
    if (action.op === 'loop-toggle' && useShowStateStore.getState().state.playbackLoop) {
      await setSectionLoop(null)
      return null
    }
    if (!current) return 'Kein Abschnitt spielt gerade'
    await setSectionLoop(current)
    return null
  }
  let target: ShowSection | undefined
  if (action.op === 'next') target = now.sections[index + 1]
  else if (action.op === 'previous') target = now.sections[Math.max(0, index - 1)]
  else {
    // By name; with the name twice in the song, the next one after where the song stands.
    const named = now.sections.filter((s) => s.label.trim().toLowerCase() === (action.label ?? '').trim().toLowerCase())
    target = named.find((s) => s.startMs > elapsed) ?? named[0]
  }
  if (!target) return action.op === 'jump' ? `Kein Abschnitt „${action.label ?? ''}“ im Song` : 'Kein Abschnitt dort'
  const result = await queueSectionJump(target, action.when ?? 'section', now.sections, now.timeline)
  return result === 'queued' ? null : result === 'not-playing' ? 'Springen, während der Song läuft' : result === 'no-boundary' ? 'Kein Ende für diesen Abschnitt bekannt' : 'Nur der Master steuert die Show'
}

async function runPlayback(op: Extract<Action, { kind: 'playback' }>['op'], show: Show): Promise<string | null> {
  if (op === 'tempo-up') show.nudgeLiveTempoAdjustPercent(1)
  else if (op === 'tempo-down') show.nudgeLiveTempoAdjustPercent(-1)
  else if (op === 'tempo-reset') show.setLiveTempoAdjustPercent(0)
  else if (op === 'ready-check') await useShowStateStore.getState().startReadyCheck()
  else if (op === 'click-toggle') {
    const song = show.queue.currentVariant ?? show.queue.currentSong
    if (!song) return 'Kein Song'
    show.setClickTrackOverride(effectiveClickEnabled(song.clickTrackEnabled, show.clickTrackOverride) ? 'off' : 'on')
  }
  return null
}
