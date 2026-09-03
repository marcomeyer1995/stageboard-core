import { computeQueue, type Queue } from './computeQueue'
import { ARMED_TRANSPORT, pause as pauseTransport, play as playTransport, type TransportState } from './playbackTransport'
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

/** Starts/resumes the current entry - loading which track to play is a separate, effect-driven
 * concern (ShowTransportWidget, same pattern as the remote engine's `load` trigger) so resuming
 * from a pause never re-triggers a reload back to position 0. */
export async function practicePlaySong(): Promise<void> {
  const { currentEntry } = snapshot()
  if (!currentEntry) return
  patch(transportPatch(playTransport(currentTransport(currentPracticeState()), Date.now())))
  playLocalTrack()
}

export async function practicePauseSong(): Promise<void> {
  patch(transportPatch(pauseTransport(currentTransport(currentPracticeState()), Date.now())))
  pauseLocalTrack()
}

export async function practiceStopSong(): Promise<void> {
  patch(transportPatch(ARMED_TRANSPORT))
  stopLocalTrack()
}

export async function practiceResetSong(): Promise<void> {
  patch(transportPatch(ARMED_TRANSPORT))
  stopLocalTrack()
}

export async function practiceAdvanceNext(): Promise<void> {
  const { nextEntry } = snapshot()
  if (!nextEntry) return
  patch({ activeEntryId: nextEntry.id, trackOverride: null, ...transportPatch(ARMED_TRANSPORT) })
  stopLocalTrack()
}

export async function practiceAdvancePrevious(): Promise<void> {
  const { previousEntry } = snapshot()
  if (!previousEntry) return
  patch({ activeEntryId: previousEntry.id, trackOverride: null, ...transportPatch(ARMED_TRANSPORT) })
  stopLocalTrack()
}

export function practiceSetTrackOverride(trackId: string | null): void {
  patch({ trackOverride: trackId })
}
