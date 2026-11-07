import { coalesced } from '../lib/coalesced'
import { create } from 'zustand'
import { ALIGNMENT_SESSION_ID, type AlignmentSession, type AudioRoute } from 'shared-types'
import type { LocalChangesHandle } from '../lib/localChanges'
import { getServerTime } from '../lib/clockSync'
import {
  alignmentSessionChanges,
  getAllAlignmentSessions,
  putAlignmentSession,
  removeAlignmentSession,
  switchAlignmentSessionWorkspace,
  updateAlignmentSession,
} from '../lib/alignmentSessionDb'

/** 100 BPM: slow enough to hear a flam between two clicks, fast enough to hear a change at once. */
export const ALIGNMENT_PERIOD_MS = 600
/** The first beat comes this much after starting - every device has the session by then. */
const START_DELAY_MS = 2_000
/** Ends by itself after this, should nobody stop it. */
const SESSION_LENGTH_MS = 10 * 60_000

interface AlignmentState {
  session: AlignmentSession | null
  init: (workspaceId: string) => Promise<void>
  start: (referenceDeviceId: string, targetDeviceId: string) => Promise<void>
  stop: () => Promise<void>
  /** The target tells which profile its scheduler uses, so the dialog changes the right value. */
  report: (output: string, route: AudioRoute) => Promise<void>
}

let changesHandle: LocalChangesHandle<AlignmentSession> | null = null

async function refresh(set: (partial: Partial<AlignmentState>) => void) {
  const all = await getAllAlignmentSessions()
  set({ session: all.find((s) => s.id === ALIGNMENT_SESSION_ID) ?? null })
}

/** The running "Abgleich nach Gehör" (docs/21 §4), band-wide. */
export const useAlignmentStore = create<AlignmentState>((set) => ({
  session: null,
  init: async (workspaceId) => {
    changesHandle?.cancel()
    changesHandle = null
    switchAlignmentSessionWorkspace(workspaceId)
    set({ session: null })
    await refresh(set)
    changesHandle = alignmentSessionChanges()
    changesHandle.on('change', coalesced(() => refresh(set)))
  },
  start: async (referenceDeviceId, targetDeviceId) => {
    const now = getServerTime()
    const startedAt = Math.ceil((now + START_DELAY_MS) / ALIGNMENT_PERIOD_MS) * ALIGNMENT_PERIOD_MS
    await putAlignmentSession({ id: ALIGNMENT_SESSION_ID, referenceDeviceId, targetDeviceId, startedAt, periodMs: ALIGNMENT_PERIOD_MS, endsAt: now + SESSION_LENGTH_MS })
  },
  stop: async () => {
    await removeAlignmentSession(ALIGNMENT_SESSION_ID)
  },
  report: async (output, route) => {
    await updateAlignmentSession(ALIGNMENT_SESSION_ID, (current) => ({ ...current, targetOutput: output, targetRoute: route }))
  },
}))

if (typeof window !== 'undefined') (window as unknown as { __sbAlignment: typeof useAlignmentStore }).__sbAlignment = useAlignmentStore
