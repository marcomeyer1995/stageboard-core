import { isSongEntry, isTransitionEntry } from 'shared-types'
import { computeQueue, resolveTrackForEntry, type Queue } from './computeQueue'
import { PLAY_LEAD_MS, type PlayOptions } from './playbackTransport'
import { clickTimeline } from './beatGrid'
import { barMsAt, countInLeadMs } from './metronome'
import {
  ARMED_TRANSPORT,
  computeActiveMs,
  pause as pauseTransport,
  play as playTransport,
  type TransportState,
} from './playbackTransport'
import { pauseLocalTrack, playLocalTrack, stopLocalTrack } from './localAudioEngine'
import { DEFAULT_PRACTICE_STATE, practiceTransportOf, usePracticeStateStore, type PracticeState } from '../store/usePracticeStateStore'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useActiveProfileStore } from '../store/useActiveProfileStore'
import { usePracticeLogStore } from '../store/usePracticeLogStore'
import { MIN_SONG_DURATION_MS } from './showLogTracking'
import { randomId } from './id'
import { stoppedNearEnd } from './entryDuration'

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
  return computeQueue(songs, setlists, practiceState, variants, practiceState.variantOverride)
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

/**
 * The transport's position is the song position, not the time played: a loop (#61) sets it to the
 * loop start and back. Every such jump inside the current take is summed here and taken off, so a
 * loop started at 2:30 and stopped after 3 s is a 3 s take, not 2:33 (#430 review).
 */
let takeJumpMs = 0

/** Records that the position is set to `positionMs` without playing there. */
function jumpPosition(positionMs: number): void {
  takeJumpMs += positionMs - computeActiveMs(currentTransport(currentPracticeState()), Date.now())
}

/**
 * Records the take that is ending (Stop, Reset, the track running out, another song or setlist)
 * as practice, if the song really ran - MIN_SONG_DURATION_MS unpaused, like a show's played song.
 * Per person (the active profile); without one nothing is recorded. The Bibliothek sorts by these
 * ("Geübt", "30 Tage" - Marco, 2026-10-07).
 */
function logPracticeTake(): void {
  const jumpMs = takeJumpMs
  takeJumpMs = 0
  const { currentSong } = snapshot()
  const profileId = useActiveProfileStore.getState().byWorkspace[activeWorkspaceId()]
  if (!currentSong || !profileId) return
  const now = Date.now()
  const activeMs = Math.round(computeActiveMs(currentTransport(currentPracticeState()), now) - jumpMs)
  if (activeMs < MIN_SONG_DURATION_MS) return
  void usePracticeLogStore.getState().add({ id: randomId(), profileId, songId: currentSong.id, at: now, activeMs })
}

function snapshot(): Queue {
  return computeQueue(
    useSongsStore.getState().songs,
    useSetlistsStore.getState().setlists,
    currentPracticeState(),
    useSongVariantsStore.getState().variants,
    currentPracticeState().variantOverride,
  )
}

function currentTransport(state: PracticeState): TransportState {
  return practiceTransportOf(state)
}

/** Every transport change also sets the jump (play and pause drop one not reached); a stop, a new
 * song or another variant also ends a loop (`ARMED_TRANSPORT` callers add `playbackLoop: null`). */
function transportPatch(t: TransportState): Partial<PracticeState> {
  return { playbackStatus: t.status, playbackStartedAt: t.startedAt, playbackAccumulatedMs: t.accumulatedMs, playbackJump: t.jump ?? null, trackEnded: false }
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
  const { currentEntry, currentSong, currentVariant, currentArrangement } = snapshot()
  // A transition item (#29) plays too - as a silent countdown: it has a clock but no audio.
  if (!currentEntry || (!currentSong && !isTransitionEntry(currentEntry))) return
  // Its variant is missing (deleted, or the song has no default): nothing to play - no other
  // arrangement in its place (Queue.currentArrangement). The status bar says why.
  if (currentSong && !currentArrangement) return
  const state = currentPracticeState()
  const isFreshStart = state.playbackStatus === 'stopped'
  // A new take starts from scratch (a reload or anything that stopped without logging).
  if (isFreshStart) takeJumpMs = 0
  const seedCountIn = isFreshStart && !opts.skipCountIn && currentSong !== null
  const activeSong = currentArrangement
  // Song time 0 lies at least PLAY_LEAD_MS ahead, as in Gig mode (queue.ts): the Web Audio track
  // and stems (useStemPlaybackDriver.ts) need that long to schedule their start - started "now",
  // the first ~0.4 s of the song was skipped (Fire and Xiaomi, 2026-10-15).
  const seededMs = seedCountIn && activeSong
    ? Math.min(-PLAY_LEAD_MS, countInLeadMs(
        clickTimeline({
          beatGrid: currentVariant?.beatGrid,
          bpm: activeSong.bpm,
          timeSignature: activeSong.timeSignature,
          countInBars: currentVariant?.countInEnabled ? currentVariant.countInBars : 0,
        }),
      ))
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
  jumpPosition(startMs)
  pauseLocalTrack()
  // The Rehearsal Looper plays its own copy - a section loop (#479) ends with it.
  patch({ ...transportPatch(playTransport({ ...ARMED_TRANSPORT, accumulatedMs: startMs }, Date.now())), playbackLoop: null })
}

/** Leaves a loop paused at `positionMs`, so the normal Play button resumes the song from there. */
export function practiceEndLoop(positionMs: number): void {
  jumpPosition(positionMs)
  patch(transportPatch({ status: 'paused', startedAt: null, accumulatedMs: positionMs, jump: null }))
}

export async function practiceStopSong(): Promise<void> {
  clearScheduledAudioStart()
  const { currentEntry, currentVariant } = snapshot()
  const state = currentPracticeState()
  const ended = stoppedNearEnd(currentEntry && isSongEntry(currentEntry) ? currentEntry : null, currentVariant, state.trackOverride, computeActiveMs(currentTransport(state), Date.now()))
  logPracticeTake()
  patch({ ...transportPatch(ARMED_TRANSPORT), playbackLoop: null, trackEnded: ended })
  stopLocalTrack()
}

/** Practice-mode twin of stopSongAtTrackEnd (#27). */
export async function practiceStopSongAtTrackEnd(): Promise<void> {
  clearScheduledAudioStart()
  logPracticeTake()
  patch({ ...transportPatch(ARMED_TRANSPORT), playbackLoop: null, trackEnded: true })
  stopLocalTrack()
}

export async function practiceResetSong(): Promise<void> {
  clearScheduledAudioStart()
  logPracticeTake()
  patch({ ...transportPatch(ARMED_TRANSPORT), playbackLoop: null })
  stopLocalTrack()
}

/** Picks which setlist Practice mode works through (`null` = the whole catalog). Never touches
 * the shared ShowState. The song list changes under the current entry, so playback stops and the
 * position/overrides reset - same shape as advancing to another entry. */
export function practiceSetActiveSetlist(setlistId: string | null): void {
  clearScheduledAudioStart()
  logPracticeTake()
  patch({
    activeSetlistId: setlistId,
    activeEntryId: null,
    trackOverride: null,
    variantOverride: null,
    clickTrackOverride: null,
    clickExtendMs: 0,
    ...transportPatch(ARMED_TRANSPORT),
    playbackLoop: null,
  })
  stopLocalTrack()
}

export async function practiceAdvanceNext(): Promise<void> {
  const { nextEntry } = snapshot()
  if (!nextEntry) return
  clearScheduledAudioStart()
  logPracticeTake()
  patch({
    activeEntryId: nextEntry.id,
    trackOverride: null,
    variantOverride: null,
    clickTrackOverride: null,
    clickExtendMs: 0,
    ...transportPatch(ARMED_TRANSPORT),
    playbackLoop: null,
  })
  stopLocalTrack()
}

export async function practiceAdvancePrevious(): Promise<void> {
  const { previousEntry } = snapshot()
  if (!previousEntry) return
  clearScheduledAudioStart()
  logPracticeTake()
  patch({
    activeEntryId: previousEntry.id,
    trackOverride: null,
    variantOverride: null,
    clickTrackOverride: null,
    clickExtendMs: 0,
    ...transportPatch(ARMED_TRANSPORT),
    playbackLoop: null,
  })
  stopLocalTrack()
}

export function practiceSetTrackOverride(trackId: string | null): void {
  patch({ trackOverride: trackId })
}

/** Switches which variant of the current song is practiced (`null` = the entry's own variant).
 * Another variant means other tracks, timing and cues, so this stops playback and drops the
 * track override (its id belongs to the old variant's tracks) - the same reset as moving to
 * another entry, just without moving. */
export function practiceSetVariantOverride(variantId: string | null): void {
  if (currentPracticeState().variantOverride === variantId) return
  clearScheduledAudioStart()
  // Switching the variant ends the take like moving to another song.
  logPracticeTake()
  patch({
    variantOverride: variantId,
    trackOverride: null,
    clickExtendMs: 0,
    ...transportPatch(ARMED_TRANSPORT),
    playbackLoop: null,
  })
  stopLocalTrack()
}

export function practiceSetClickTrackOverride(override: 'on' | 'off' | null): void {
  patch({ clickTrackOverride: override })
}

/** Practice mode's counterpart to queue.ts's `extendClickTrack` - no Master-Token to gate here,
 * same reasoning every other practice action above already follows. */
export function practiceExtendClickTrack(bars: number): void {
  const state = currentPracticeState()
  if (state.playbackStatus === 'stopped') return
  const { currentVariant, currentArrangement } = snapshot()
  if (!currentArrangement) return
  const activeSong = currentArrangement
  const elapsedMs = computeActiveMs(currentTransport(state), Date.now())
  const perBarMs = barMsAt(
    elapsedMs,
    clickTimeline({
      beatGrid: currentVariant?.beatGrid,
      bpm: activeSong.bpm,
      timeSignature: activeSong.timeSignature,
      countInBars: currentVariant?.countInEnabled ? currentVariant.countInBars : 0,
    }),
  )
  patch({ clickExtendMs: state.clickExtendMs + bars * perBarMs })
}
