import { useEffect, useReducer, useRef } from 'react'
import type { PlaybackStatus } from 'shared-types'
import type { Queue } from './computeQueue'
import type { PlayOptions } from './playbackTransport'
import {
  advanceToNextSong,
  advanceToPreviousSong,
  nudgeLiveTempoAdjustPercent,
  pauseSong,
  playSong,
  resetSong,
  setClickTrackOverride,
  setLiveTempoAdjustPercent,
  setTrackOverride,
  stopSong,
  stopSongAtTrackEnd,
  useQueue,
} from './queue'
import {
  practiceAdvanceNext,
  practiceAdvancePrevious,
  practicePauseSong,
  practicePlaySong,
  practiceResetSong,
  practiceSetClickTrackOverride,
  practiceSetTrackOverride,
  practiceSetVariantOverride,
  practiceStopSong,
  practiceStopSongAtTrackEnd,
  usePracticeQueue,
} from './practiceQueue'
import { gigElapsedMsNow } from './usePlaybackElapsedMs'
import { practiceElapsedMsNow } from './usePracticeElapsedMs'
import { useLoopTrainerStore } from '../store/useLoopTrainerStore'
import { useAppModeStore, type SessionMode } from '../store/useAppModeStore'
import { DEFAULT_PRACTICE_STATE, usePracticeStateStore } from '../store/usePracticeStateStore'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export interface ShowModeApi {
  mode: SessionMode
  queue: Queue
  /**
   * The song position right now, read when called - not a value that re-renders (#457): a
   * component that shows the time uses useShowElapsed() for exactly what it shows; a handler
   * (a key press, a button) calls this at that moment.
   */
  elapsedNow: () => number | null
  playbackStatus: PlaybackStatus
  trackOverride: string | null
  /** Live +/- tempo correction on top of the current song's bpm (#140) - Gig mode only, always
   * 0/no-op in Practice mode (that's #61's Speed Trainer's territory, a deliberate practice
   * choice rather than a live-drift correction). */
  liveTempoAdjustPercent: number
  setLiveTempoAdjustPercent: (percent: number) => void
  nudgeLiveTempoAdjustPercent: (deltaPercent: number) => void
  /** Force-on/force-off of the Click Generator for the current song, overriding its own
   * authored `clickTrackEnabled` default (#25) - `null` means "use that default". Gig mode's
   * is a Master-gated, shared ShowState field (one band-wide click); Practice mode's is a
   * local, ungated per-device choice (usePracticeStateStore) - training with a fixed rhythm is
   * exactly what solo practice is for, so unlike liveTempoAdjustPercent this isn't Gig-only. */
  clickTrackOverride: 'on' | 'off' | null
  setClickTrackOverride: (override: 'on' | 'off' | null) => void
  /** How far (ms) the current entry's auto-stop point (#231, `useAutoStopDriver.ts`) has been
   * pushed forward by the live bar-extend trigger - read-only here (fired via
   * CustomTriggerWidget/clientTranslator.ts's `click-track` translator, not a direct UI action
   * on any queue/transport widget), so ShowTransportWidget can show "running in extended time". */
  clickExtendMs: number
  /** Whether THIS device may act right now - the Master-Token in Gig mode (unchanged), always
   * true in Practice mode (fully local, nothing to contend over). */
  canControl: boolean
  /** Runs the automatic master steps (next/stop at the track end, measuring tracks) - one device
   * even in Pro-Person mode (drivesAutomation in useShowStateStore.ts); always true in Solo. */
  drivesAutomation: boolean
  play: (opts?: PlayOptions) => Promise<void>
  pause: () => Promise<void>
  stop: () => Promise<void>
  /** Stop because the track ran out by itself - marks the entry "Beendet" (#27). */
  stopAtTrackEnd: () => Promise<void>
  /** The current entry stopped because its track ran out ("Beendet", #27). */
  trackEnded: boolean
  reset: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  setTrackOverride: (trackId: string | null) => void
  /** Practice mode's variant picker (`null` = the entry's own variant). Gig mode has none - the
   * variant there is the setlist's, a band-wide choice - so `setVariantOverride` is `null` in
   * Gig mode, which is also how TrackOverrideWidget decides whether to offer the picker. */
  variantOverride: string | null
  setVariantOverride: ((variantId: string | null) => void) | null
}

/**
 * The current song and playback state of the mode this device is in, **without** the per-frame
 * elapsed time: useShowMode() re-renders its caller on every animation frame while playing, which
 * an always-mounted hook (App.tsx) must never do - it re-rendered the whole app 60 times a second
 * (#400 review). `elapsedNow()` reads the position when asked.
 */
export function useShowModeSong(): { mode: SessionMode; queue: Queue; playbackStatus: PlaybackStatus; elapsedNow: () => number | null } {
  const mode = useAppModeStore((state) => state.mode)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const gigQueue = useQueue()
  const practiceQueue = usePracticeQueue()
  const gigPlaybackStatus = useShowStateStore((state) => state.state.playbackStatus)
  const practicePlaybackStatus = usePracticeStateStore((state) => (state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE).playbackStatus)
  if (mode === 'practice') return { mode, queue: practiceQueue, playbackStatus: practicePlaybackStatus, elapsedNow: () => practiceElapsedMsNow(workspaceId) }
  return { mode, queue: gigQueue, playbackStatus: gigPlaybackStatus, elapsedNow: gigElapsedMsNow }
}

/**
 * The single thing every queue/transport-facing widget (NextSongWidget, ShowTransportWidget,
 * TrackOverrideWidget, PrompterWidget) reads instead of useQueue()/useShowStateStore directly -
 * so none of them need their own Gig-vs-Practice branching. Both underlying hooks are always
 * called (rules of hooks), and the inactive one's result is simply discarded; that's cheap
 * compared to the alternative of every widget re-implementing this same branch.
 */
export function useShowMode(): ShowModeApi {
  const mode = useAppModeStore((state) => state.mode)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)

  const gigQueue = useQueue()
  const practiceQueue = usePracticeQueue()
  const gigPlaybackStatus = useShowStateStore((state) => state.state.playbackStatus)
  const gigDrives = useShowStateStore(drivesAutomation)
  const gigTrackOverride = useShowStateStore((state) => state.state.trackOverride)
  const gigLiveTempoAdjustPercent = useShowStateStore((state) => state.state.liveTempoAdjustPercent)
  const gigClickTrackOverride = useShowStateStore((state) => state.state.clickTrackOverride)
  const gigClickExtendMs = useShowStateStore((state) => state.state.clickExtendMs)
  const gigTrackEnded = useShowStateStore((state) => state.state.trackEnded === true)
  const practiceState = usePracticeStateStore((state) => state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE)

  if (mode === 'practice') {
    return {
      mode,
      queue: practiceQueue,
      elapsedNow: () => practiceElapsedMsNow(workspaceId),
      playbackStatus: practiceState.playbackStatus,
      trackOverride: practiceState.trackOverride,
      liveTempoAdjustPercent: 0,
      setLiveTempoAdjustPercent: () => {},
      nudgeLiveTempoAdjustPercent: () => {},
      clickTrackOverride: practiceState.clickTrackOverride,
      setClickTrackOverride: practiceSetClickTrackOverride,
      clickExtendMs: practiceState.clickExtendMs,
      canControl: true,
      drivesAutomation: true,
      play: practicePlaySong,
      pause: practicePauseSong,
      stop: practiceStopSong,
      stopAtTrackEnd: practiceStopSongAtTrackEnd,
      trackEnded: practiceState.trackEnded === true,
      reset: practiceResetSong,
      next: practiceAdvanceNext,
      previous: practiceAdvancePrevious,
      setTrackOverride: practiceSetTrackOverride,
      variantOverride: practiceState.variantOverride,
      setVariantOverride: practiceSetVariantOverride,
    }
  }

  return {
    mode,
    queue: gigQueue,
    elapsedNow: gigElapsedMsNow,
    playbackStatus: gigPlaybackStatus,
    trackOverride: gigTrackOverride,
    liveTempoAdjustPercent: gigLiveTempoAdjustPercent,
    setLiveTempoAdjustPercent: (percent) => void setLiveTempoAdjustPercent(percent),
    nudgeLiveTempoAdjustPercent: (deltaPercent) => void nudgeLiveTempoAdjustPercent(deltaPercent),
    clickTrackOverride: gigClickTrackOverride,
    setClickTrackOverride: (override) => void setClickTrackOverride(override),
    clickExtendMs: gigClickExtendMs,
    canControl: gigQueue.isMaster,
    drivesAutomation: gigDrives,
    play: playSong,
    pause: pauseSong,
    stop: stopSong,
    stopAtTrackEnd: stopSongAtTrackEnd,
    trackEnded: gigTrackEnded,
    reset: resetSong,
    next: advanceToNextSong,
    previous: advanceToPreviousSong,
    setTrackOverride: (trackId) => void setTrackOverride(trackId),
    variantOverride: null,
    setVariantOverride: null,
  }
}

/**
 * What a component shows of the running song position, re-rendered only when that changes (#457):
 * `select` turns the position (null while stopped) into the shown value - "1:23", the active
 * prompter line, the count-in beat - and is checked on every animation frame while playing, but
 * the component renders again only when the result differs (`isEqual`, default Object.is - so
 * return primitives or compare yourself). Measured 2026-10-08: the whole dashboard re-rendering
 * 60x per second for a time that changes once per second cost 40-80 % CPU while playing.
 *
 * `select` may close over render values (the song's lines, its grid): the latest one is used.
 */
export function useShowElapsed<T>(select: (elapsedMs: number | null) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  const mode = useAppModeStore((state) => state.mode)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  // Subscribed so a pause, a seek or a stop renders the new position (no frames run then).
  const gig = useShowStateStore((state) => `${state.state.playbackStatus}|${state.state.playbackStartedAt}|${state.state.playbackAccumulatedMs}`)
  const practice = usePracticeStateStore((state) => {
    const p = state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE
    return `${p.playbackStatus}|${p.playbackStartedAt}|${p.playbackAccumulatedMs}`
  })
  const loopActive = useLoopTrainerStore((state) => state.active)
  const status = (mode === 'practice' ? practice : gig).split('|')[0] as PlaybackStatus
  const now = () => (mode === 'practice' ? practiceElapsedMsNow(workspaceId) : gigElapsedMsNow())

  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const value = select(now())
  const latest = useRef({ select, isEqual, now, value })
  latest.current = { select, isEqual, now, value }

  useEffect(() => {
    if (status !== 'playing') return
    let frame: number
    const tick = () => {
      const l = latest.current
      if (!l.isEqual(l.select(l.now()), l.value)) rerender()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [status, mode, loopActive])

  return value
}
