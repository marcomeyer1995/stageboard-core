import { isTransitionEntry } from 'shared-types'
import { computeQueue, resolveTrackForEntry, type Queue } from './computeQueue'
import type { PlayOptions } from './playbackTransport'
import { barMsAt, countInLeadMs } from './metronome'
import {
  ARMED_TRANSPORT,
  computeActiveMs,
  pause as pauseTransport,
  play as playTransport,
  type TransportState,
} from './playbackTransport'
import { pauseLocalTrack, playLocalTrack, stopLocalTrack } from './localAudioEngine'
import { DEFAULT_PRACTICE_STATE, usePracticeStateStore, type PracticeState } from '../store/usePracticeStateStore'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Practice mode's counterpart to queue.ts - deliberately never touches the real, synced
 * ShowState/ShowLog (useAppModeStore.ts explains why). No Master-Token, no logging: this is
 * one device's own private position in the catalog, so every action here just patches the
 * local usePracticeStateStore directly, unconditionally.
 */
export function usePracticeQueue(): Queue {
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const songs = useSongsStore((state) => state.songs)
  const setlists = useSetlistsStore((state) => state.setlists)
  const variants = useSongVariantsStore((state) => state.variants)
  const practiceState = usePracticeStateStore((state) => state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE)
  return computeQueue(songs, setlists, practiceState, variants)
}

function activeWorkspaceId(): string {
  return useWorkspaceStore.getState().activeWorkspaceId
}

function currentPracticeState(): PracticeState {
  return usePracticeStateStore.getState().get(activeWorkspaceId())
}

function patch(next: Partial<PracticeState>): void {
  usePracticeStateStore.getState().patch(activeWorkspaceId(), next)
}

function snapshot(): Queue {
  return computeQueue(
    useSongsStore.getState().songs,
    useSetlistsStore.getState().setlists,
    currentPracticeState(),
    useSongVariantsStore.getState().variants,
  )
}

function currentTransport(state: PracticeState): TransportState {
  return { status: state.playbackStatus, startedAt: state.playbackStartedAt, accumulatedMs: state.playbackAccumulatedMs }
}

function transportPatch(t: TransportState): Partial<PracticeState> {
  return { playbackStatus: t.status, playbackStartedAt: t.startedAt, playbackAccumulatedMs: t.accumulatedMs }
}

/** Cancels a pending deferred audio start (see `practicePlaySong` below) - every action that can
 * interrupt a count-in still in progress (pause, stop, reset, advancing) must call this before
 * touching `playbackStatus`, or a stale scheduled `playLocalTrack` could fire after the fact. */
let scheduledAudioStart: ReturnType<typeof setTimeout> | null = null
function clearScheduledAudioStart(): void {
  if (scheduledAudioStart !== null) clearTimeout(scheduledAudioStart)
  scheduledAudioStart = null
}

/** Starts/resumes the current entry - loading which track to play is a separate, effect-driven
 * concern (ShowTransportWidget, same pattern as the remote engine's `load` trigger) so resuming
 * from a pause never re-triggers a reload back to position 0. Reads the accumulated position
 * *before* patching to 'playing' - `playLocalTrack` seeks there explicitly (found live,
 * 2026-09-10: it used to just resume from wherever the element happened to be cued).
 *
 * On a genuinely fresh start (`playbackStatus === 'stopped'`, which only ever pairs with
 * `accumulatedMs: 0` via ARMED_TRANSPORT - Practice mode's equivalent of queue.ts's
 * `activeEntryStartedAt === null` check), seeds a count-in lead (#25 follow-up) the same way Gig
 * mode does. Unlike Gig mode's reactive `useAudioOutputDriver.ts`, this calls `playLocalTrack`
 * synchronously - so a negative seed defers the actual call via `setTimeout` instead of a
 * reactive effect, for exactly however long remains until elapsedMs would reach 0. A
 * pause-then-resume mid-count-in needs no extra bookkeeping: each call here freshly reads
 * whatever `accumulatedMs` pause froze and reschedules from there. */
export async function practicePlaySong(opts: PlayOptions = {}): Promise<void> {
  const { currentEntry, currentSong, currentVariant } = snapshot()
  // A transition item (#29) plays too - as a silent countdown: it has a clock but no audio.
  if (!currentEntry || (!currentSong && !isTransitionEntry(currentEntry))) return
  const state = currentPracticeState()
  const isFreshStart = state.playbackStatus === 'stopped'
  const seedCountIn = isFreshStart && !opts.skipCountIn && currentSong !== null
  const activeSong = currentVariant ?? currentSong
  const seededMs = seedCountIn && activeSong
    ? countInLeadMs(
        currentVariant?.beatAnchors ?? [],
        activeSong.bpm,
        activeSong.timeSignature,
        currentVariant?.countInEnabled ? currentVariant.countInBars : 0,
      )
    : isFreshStart
      ? 0
      : state.playbackAccumulatedMs
  patch(transportPatch(playTransport({ ...currentTransport(state), accumulatedMs: seededMs }, Date.now())))

  clearScheduledAudioStart()
  if (!currentSong) return
  if (seededMs < 0) {
    scheduledAudioStart = setTimeout(() => {
      scheduledAudioStart = null
      void playLocalTrack(0)
    }, -seededMs)
  } else {
    void playLocalTrack(seededMs)
  }
}

export async function practicePauseSong(): Promise<void> {
  clearScheduledAudioStart()
  patch(transportPatch(pauseTransport(currentTransport(currentPracticeState()), Date.now())))
  pauseLocalTrack()
}

/** What the Rehearsal Looper (#61) needs to know about the current practice entry: which track
 * would play (honouring this device's own track override) and the entry to tie its settings to. */
export function practiceLoopContext(): { entryId: string; variantId: string; trackId: string } | null {
  const { currentEntry, currentVariant } = snapshot()
  const track = resolveTrackForEntry(currentEntry, currentVariant, currentPracticeState().trackOverride)
  if (!currentEntry || !currentVariant || !track) return null
  return { entryId: currentEntry.id, variantId: currentVariant.id, trackId: track.id }
}

/** Marks practice as playing from `startMs` for a loop: the transport (Prompter, click, transport
 * buttons) then reads "playing" while the loop engine, not this transport's own wall clock,
 * supplies the position (usePracticeElapsedMs.ts). The `<audio>` element is silenced so the
 * two never sound together. */
export function practiceBeginLoop(startMs: number): void {
  clearScheduledAudioStart()
  pauseLocalTrack()
  patch(transportPatch(playTransport({ ...ARMED_TRANSPORT, accumulatedMs: startMs }, Date.now())))
}

/** Leaves a loop paused at `positionMs`, so the normal Play button resumes the song from there. */
export function practiceEndLoop(positionMs: number): void {
  patch(transportPatch({ status: 'paused', startedAt: null, accumulatedMs: positionMs }))
}

export async function practiceStopSong(): Promise<void> {
  clearScheduledAudioStart()
  patch(transportPatch(ARMED_TRANSPORT))
  stopLocalTrack()
}

export async function practiceResetSong(): Promise<void> {
  clearScheduledAudioStart()
  patch(transportPatch(ARMED_TRANSPORT))
  stopLocalTrack()
}

/** Picks which setlist Practice mode works through (`null` = the whole catalog). Never touches
 * the shared ShowState. The song list changes under the current entry, so playback stops and the
 * position/overrides reset - same shape as advancing to another entry. */
export function practiceSetActiveSetlist(setlistId: string | null): void {
  clearScheduledAudioStart()
  patch({
    activeSetlistId: setlistId,
    activeEntryId: null,
    trackOverride: null,
    clickTrackOverride: null,
    clickExtendMs: 0,
    ...transportPatch(ARMED_TRANSPORT),
  })
  stopLocalTrack()
}

export async function practiceAdvanceNext(): Promise<void> {
  const { nextEntry } = snapshot()
  if (!nextEntry) return
  clearScheduledAudioStart()
  patch({
    activeEntryId: nextEntry.id,
    trackOverride: null,
    clickTrackOverride: null,
    clickExtendMs: 0,
    ...transportPatch(ARMED_TRANSPORT),
  })
  stopLocalTrack()
}

export async function practiceAdvancePrevious(): Promise<void> {
  const { previousEntry } = snapshot()
  if (!previousEntry) return
  clearScheduledAudioStart()
  patch({
    activeEntryId: previousEntry.id,
    trackOverride: null,
    clickTrackOverride: null,
    clickExtendMs: 0,
    ...transportPatch(ARMED_TRANSPORT),
  })
  stopLocalTrack()
}

export function practiceSetTrackOverride(trackId: string | null): void {
  patch({ trackOverride: trackId })
}

export function practiceSetClickTrackOverride(override: 'on' | 'off' | null): void {
  patch({ clickTrackOverride: override })
}

/** Practice mode's counterpart to queue.ts's `extendClickTrack` - no Master-Token to gate here,
 * same reasoning every other practice action above already follows. */
export function practiceExtendClickTrack(bars: number): void {
  const state = currentPracticeState()
  if (state.playbackStatus === 'stopped') return
  const { currentSong, currentVariant } = snapshot()
  if (!currentSong) return
  const activeSong = currentVariant ?? currentSong
  const elapsedMs = computeActiveMs(currentTransport(state), Date.now())
  const perBarMs = barMsAt(
    elapsedMs,
    activeSong.bpm,
    activeSong.timeSignature,
    currentVariant?.beatAnchors ?? [],
    currentVariant?.countInEnabled ? currentVariant.countInBars : 0,
    currentVariant?.tempoMarkers ?? [],
  )
  patch({ clickExtendMs: state.clickExtendMs + bars * perBarMs })
}
