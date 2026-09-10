import type { PlaybackStatus } from 'shared-types'
import type { Queue } from './computeQueue'
import {
  advanceToNextSong,
  advanceToPreviousSong,
  nudgeLiveTempoAdjustPercent,
  pauseSong,
  playSong,
  resetSong,
  setLiveTempoAdjustPercent,
  setTrackOverride,
  stopSong,
  useQueue,
} from './queue'
import {
  practiceAdvanceNext,
  practiceAdvancePrevious,
  practicePauseSong,
  practicePlaySong,
  practiceResetSong,
  practiceSetTrackOverride,
  practiceStopSong,
  usePracticeQueue,
} from './practiceQueue'
import { usePlaybackElapsedMs } from './usePlaybackElapsedMs'
import { usePracticeElapsedMs } from './usePracticeElapsedMs'
import { useAppModeStore, type SessionMode } from '../store/useAppModeStore'
import { DEFAULT_PRACTICE_STATE, usePracticeStateStore } from '../store/usePracticeStateStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export interface ShowModeApi {
  mode: SessionMode
  queue: Queue
  elapsedMs: number | null
  playbackStatus: PlaybackStatus
  trackOverride: string | null
  /** Live +/- tempo correction on top of the current song's bpm (#140) - Gig mode only, always
   * 0/no-op in Practice mode (that's #61's Speed Trainer's territory, a deliberate practice
   * choice rather than a live-drift correction). */
  liveTempoAdjustPercent: number
  setLiveTempoAdjustPercent: (percent: number) => void
  nudgeLiveTempoAdjustPercent: (deltaPercent: number) => void
  /** Whether THIS device may act right now - the Master-Token in Gig mode (unchanged), always
   * true in Practice mode (fully local, nothing to contend over). */
  canControl: boolean
  play: () => Promise<void>
  pause: () => Promise<void>
  stop: () => Promise<void>
  reset: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  setTrackOverride: (trackId: string | null) => void
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
  const gigElapsedMs = usePlaybackElapsedMs()
  const practiceElapsedMs = usePracticeElapsedMs()
  const gigPlaybackStatus = useShowStateStore((state) => state.state.playbackStatus)
  const gigTrackOverride = useShowStateStore((state) => state.state.trackOverride)
  const gigLiveTempoAdjustPercent = useShowStateStore((state) => state.state.liveTempoAdjustPercent)
  const practiceState = usePracticeStateStore((state) => state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE)

  if (mode === 'practice') {
    return {
      mode,
      queue: practiceQueue,
      elapsedMs: practiceElapsedMs,
      playbackStatus: practiceState.playbackStatus,
      trackOverride: practiceState.trackOverride,
      liveTempoAdjustPercent: 0,
      setLiveTempoAdjustPercent: () => {},
      nudgeLiveTempoAdjustPercent: () => {},
      canControl: true,
      play: practicePlaySong,
      pause: practicePauseSong,
      stop: practiceStopSong,
      reset: practiceResetSong,
      next: practiceAdvanceNext,
      previous: practiceAdvancePrevious,
      setTrackOverride: practiceSetTrackOverride,
    }
  }

  return {
    mode,
    queue: gigQueue,
    elapsedMs: gigElapsedMs,
    playbackStatus: gigPlaybackStatus,
    trackOverride: gigTrackOverride,
    liveTempoAdjustPercent: gigLiveTempoAdjustPercent,
    setLiveTempoAdjustPercent: (percent) => void setLiveTempoAdjustPercent(percent),
    nudgeLiveTempoAdjustPercent: (deltaPercent) => void nudgeLiveTempoAdjustPercent(deltaPercent),
    canControl: gigQueue.isMaster,
    play: playSong,
    pause: pauseSong,
    stop: stopSong,
    reset: resetSong,
    next: advanceToNextSong,
    previous: advanceToPreviousSong,
    setTrackOverride: (trackId) => void setTrackOverride(trackId),
  }
}
