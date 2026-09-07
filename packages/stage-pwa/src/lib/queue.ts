import type { ShowState } from 'shared-types'
import { computeQueue, type Queue } from './computeQueue'
import { randomId } from './id'
import { ARMED_TRANSPORT, computeActiveMs, pause as pauseTransport, play as playTransport, type TransportState } from './playbackTransport'
import { finalizeSongPlay, shouldStartNewShow } from './showLogTracking'
import { useSetlistsStore } from '../store/useSetlistsStore'
import { useShowLogStore } from '../store/useShowLogStore'
import { useShowStateStore } from '../store/useShowStateStore'
import { useSongsStore } from '../store/useSongsStore'
import { useSongVariantsStore } from '../store/useSongVariantsStore'

/** Reactive queue for use in components: current/next song, honoring the active setlist's order. */
export function useQueue(): Queue & { isMaster: boolean } {
  const songs = useSongsStore((state) => state.songs)
  const setlists = useSetlistsStore((state) => state.setlists)
  const showState = useShowStateStore((state) => state.state)
  const isMaster = useShowStateStore((state) => state.isMaster)
  const variants = useSongVariantsStore((state) => state.variants)

  return { ...computeQueue(songs, setlists, showState, variants), isMaster }
}

/** Non-reactive equivalent for imperative callers (e.g. the MIDI trigger handler). */
export function getQueueSnapshot(): Queue {
  return computeQueue(
    useSongsStore.getState().songs,
    useSetlistsStore.getState().setlists,
    useShowStateStore.getState().state,
    useSongVariantsStore.getState().variants,
  )
}

function currentTransport(state: ShowState): TransportState {
  return { status: state.playbackStatus, startedAt: state.playbackStartedAt, accumulatedMs: state.playbackAccumulatedMs }
}

function transportPatch(t: TransportState): Partial<ShowState> {
  return { playbackStatus: t.status, playbackStartedAt: t.startedAt, playbackAccumulatedMs: t.accumulatedMs }
}

/** Rearms the current entry: no time accumulated, no active-entry-started marker - what both
 * Stop (after logging, below) and Reset leave behind, so a later Play on the same entry starts
 * a genuinely new take rather than silently extending the old one. */
const REARM_PATCH: Partial<ShowState> = { ...transportPatch(ARMED_TRANSPORT), activeEntryStartedAt: null }

/** Logs the currently active entry's play-through if its active (unpaused) duration crossed
 * the minimum threshold - shared by every transition that ends a play-through: advancing the
 * queue, or an explicit Stop (#13). A no-op if the current entry was never actually activated
 * (activeEntryStartedAt null - e.g. Stop pressed with nothing ever having played). */
function finalizeCurrentSong(state: ShowState, now: number): void {
  const { currentEntry, currentSong } = getQueueSnapshot()
  if (currentEntry === null || currentSong === null || state.activeEntryStartedAt === null) return

  const activeMs = computeActiveMs(currentTransport(state), now)
  const showId = state.currentShowId ?? randomId()
  const result = finalizeSongPlay({ songId: currentSong.id, songTitle: currentSong.title }, state.activeEntryStartedAt, activeMs, now, showId)
  if (result) void useShowLogStore.getState().append({ id: randomId(), type: 'song-played', ...result })
}

/** Starts a fresh `show` in ShowLog if enough idle time passed since the last activity,
 * otherwise just bumps `lastActivityAt` - shared by every transition that activates an entry
 * for the first time (advancing the queue, or the very first Play of a session). */
function showBookkeepingPatch(state: ShowState, now: number): Partial<ShowState> {
  if (!shouldStartNewShow(state.lastActivityAt, now)) return { lastActivityAt: now }
  const showId = randomId()
  void useShowLogStore.getState().append({ id: randomId(), showId, type: 'show-started', at: now })
  return { currentShowId: showId, lastActivityAt: now }
}

/** Finalizes the outgoing entry's play-through, then activates `entryId` fresh (rearmed
 * transport, new activeEntryStartedAt) - the shared body of advanceToNextSong/PreviousSong. */
async function activateEntry(entryId: string): Promise<void> {
  const { isMaster, state, applyPatch } = useShowStateStore.getState()
  if (!isMaster) return
  const now = Date.now()
  finalizeCurrentSong(state, now)
  await applyPatch({
    activeEntryId: entryId,
    activeEntryStartedAt: now,
    trackOverride: null,
    ...transportPatch(ARMED_TRANSPORT),
    ...showBookkeepingPatch(state, now),
  })
}

/** Advances to the next song in the queue - only the Master-Token holder may do this. */
export async function advanceToNextSong(): Promise<void> {
  const { nextEntry } = getQueueSnapshot()
  if (!nextEntry) return
  await activateEntry(nextEntry.id)
}

/** Goes back to the previous song in the queue - only the Master-Token holder may do this. */
export async function advanceToPreviousSong(): Promise<void> {
  const { previousEntry } = getQueueSnapshot()
  if (!previousEntry) return
  await activateEntry(previousEntry.id)
}

/** Starts or resumes playback of the current entry (ShowTransportWidget's Play, #13). Also
 * bootstraps activation bookkeeping for a song that was never explicitly advanced to - e.g.
 * the very first song of a session, before "Next Song" has ever been pressed. */
export async function playSong(): Promise<void> {
  const { isMaster, state, applyPatch } = useShowStateStore.getState()
  if (!isMaster) return
  const { currentEntry, currentSong } = getQueueSnapshot()
  if (!currentEntry || !currentSong) return
  const now = Date.now()

  const patch: Partial<ShowState> = transportPatch(playTransport(currentTransport(state), now))
  if (state.activeEntryStartedAt === null) {
    Object.assign(patch, { activeEntryId: currentEntry.id, activeEntryStartedAt: now }, showBookkeepingPatch(state, now))
  }
  await applyPatch(patch)
}

/** Freezes the current entry's play timer, expecting a resume soon (stage banter, retuning) -
 * excluded from the eventual logged duration (#13). */
export async function pauseSong(): Promise<void> {
  const { isMaster, state, applyPatch } = useShowStateStore.getState()
  if (!isMaster) return
  await applyPatch(transportPatch(pauseTransport(currentTransport(state), Date.now())))
}

/** Ends the current entry's play-through now: logs it if it qualifies, then rearms - unlike
 * Pause, this is a deliberate "we're done with this song" boundary. */
export async function stopSong(): Promise<void> {
  const { isMaster, state, applyPatch } = useShowStateStore.getState()
  if (!isMaster) return
  finalizeCurrentSong(state, Date.now())
  await applyPatch(REARM_PATCH)
}

/** Rearms the current entry without logging anything - an explicit "that didn't count"
 * override (a false start), usable even past the confirmation threshold, unlike Stop. */
export async function resetSong(): Promise<void> {
  const { isMaster, applyPatch } = useShowStateStore.getState()
  if (!isMaster) return
  await applyPatch(REARM_PATCH)
}

/** Swaps which of the current entry's tracks the shared live feed plays - e.g. a missing
 * guitarist means tonight needs the "1 guitar" mix instead of the setlist's usual "no guitar"
 * one (TrackOverrideWidget). Master-gated like every other ShowState write: it changes what
 * the whole band's shared audio-playback plugin plays, not a personal preference. Cleared
 * automatically once the entry changes (activateEntry above), so it never silently carries
 * over onto a different song. */
export async function setTrackOverride(trackId: string | null): Promise<void> {
  const { isMaster, applyPatch } = useShowStateStore.getState()
  if (!isMaster) return
  await applyPatch({ trackOverride: trackId })
}
