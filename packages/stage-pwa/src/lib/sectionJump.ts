import { useEffect } from 'react'
import { getServerTime } from './clockSync'
import { computeActiveMs, foldJump, transportOf, type SectionJump, type TransportState } from './playbackTransport'
import { jumpBoundary, type JumpWhen, type ShowSection } from './showSections'
import type { ClickTimeline } from './beatGrid'
import { useAppModeStore } from '../store/useAppModeStore'
import { practiceTransportOf, usePracticeStateStore } from '../store/usePracticeStateStore'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Section jump and loop in the show (#479, docs/20 §4). The master queues a jump; it happens on a
 * bar or section boundary at least JUMP_NOTICE_MS ahead, so every device learns of it in time and
 * click, track and cues continue at the target exactly on the beat. In Solo Üben the same on this
 * device's own practice state (Marco, 2026-10-22) - its track plays on Web Audio (stemEngine.ts).
 */

/** How far ahead a jump is announced - Wi-Fi to every device, and the track's target decoded. */
export const JUMP_NOTICE_MS = 1500
/** A queued jump closer than this can no longer be called off - the track takes it over 0.9 s
 * ahead (webAudioTrackEngine JUMP_COMMIT_S); calling it off after that cost an audible restart. */
const CANCEL_MIN_MS = 1000
/** The driving device queues a loop's way back this long before the section end. */
const LOOP_NOTICE_MS = 2000
/** How often the driving device looks at jump and loop. */
const DRIVER_TICK_MS = 100

export type JumpResult = 'queued' | 'not-master' | 'not-playing' | 'no-boundary'

type Loop = { startMs: number; endMs: number; label?: string }

/** Where a jump lives: the band's show state (Gig, the master acts, server time) or this device's
 * practice state (Solo, always allowed, its own clock). */
interface JumpHost {
  allowed: boolean
  now: () => number
  transport: TransportState
  loop: Loop | null
  write: (patch: { startedAt?: number | null; accumulatedMs?: number; skippedMs?: number; jump?: SectionJump | null; loop?: Loop | null }) => Promise<void>
}

function gigHost(): JumpHost {
  const { isMaster, state, applyPatch } = useShowStateStore.getState()
  return {
    allowed: isMaster,
    now: getServerTime,
    transport: transportOf(state),
    loop: state.playbackLoop ?? null,
    write: async (patch) => {
      await applyPatch({
        ...(patch.startedAt !== undefined ? { playbackStartedAt: patch.startedAt } : {}),
        ...(patch.accumulatedMs !== undefined ? { playbackAccumulatedMs: patch.accumulatedMs } : {}),
        ...(patch.skippedMs !== undefined ? { playbackSkippedMs: patch.skippedMs } : {}),
        ...(patch.jump !== undefined ? { playbackJump: patch.jump } : {}),
        ...(patch.loop !== undefined ? { playbackLoop: patch.loop } : {}),
      })
    },
  }
}

function practiceHost(): JumpHost {
  const workspaceId = useWorkspaceStore.getState().activeWorkspaceId
  const store = usePracticeStateStore.getState()
  const state = store.get(workspaceId)
  return {
    allowed: true,
    now: Date.now,
    transport: practiceTransportOf(state),
    loop: state.playbackLoop ?? null,
    write: async (patch) => {
      store.patch(workspaceId, {
        ...(patch.startedAt !== undefined ? { playbackStartedAt: patch.startedAt } : {}),
        ...(patch.accumulatedMs !== undefined ? { playbackAccumulatedMs: patch.accumulatedMs } : {}),
        ...(patch.jump !== undefined ? { playbackJump: patch.jump } : {}),
        ...(patch.loop !== undefined ? { playbackLoop: patch.loop } : {}),
      })
    },
  }
}

/** Into the Nachbericht (#673) - only the show's own jumps, not Solo Üben. Queue and show log are
 * loaded lazily: this module stays light for the timeline, which uses it without a band. */
function recordSection(input: { action: 'jump' | 'jump-cancelled' | 'repeat' | 'repeat-end'; at?: number; fromLabel?: string; toLabel?: string; fromMs?: number; toMs?: number }): void {
  if (useAppModeStore.getState().mode === 'practice') return
  void Promise.all([import('./queue'), import('./showLogRecord')])
    .then(([queue, log]) => {
      const { currentSong } = queue.getQueueSnapshot()
      log.recordShowEvent({
        type: 'section',
        songId: currentSong?.id ?? null,
        songTitle: currentSong?.title ?? '',
        ...input,
        ...(input.fromMs !== undefined ? { fromMs: Math.round(input.fromMs) } : {}),
        ...(input.toMs !== undefined ? { toMs: Math.round(input.toMs) } : {}),
      })
    })
    .catch(() => undefined)
}

/** The section a song time lies in. */
function sectionAt(sections: readonly ShowSection[], ms: number): ShowSection | undefined {
  return sections.find((section) => section.startMs <= ms && (section.endMs === null || ms < section.endMs))
}

/** The host of the mode this device is in. */
function host(): JumpHost {
  return useAppModeStore.getState().mode === 'practice' ? practiceHost() : gigHost()
}

/** Queues a jump to `target` at the next bar line or the end of the section playing. Replaces a
 * jump queued before and ends a loop. */
export async function queueSectionJump(target: ShowSection, when: JumpWhen, sections: readonly ShowSection[], timeline: ClickTimeline): Promise<JumpResult> {
  const h = host()
  if (!h.allowed) return 'not-master'
  if (h.transport.status !== 'playing' || h.transport.startedAt === null) return 'not-playing'
  const now = h.now()
  const transport = foldJump(h.transport, now)
  if (transport.startedAt === null) return 'not-playing'
  const boundary = jumpBoundary(when, computeActiveMs(transport, now) + JUMP_NOTICE_MS, sections, timeline)
  if (boundary === null) return 'no-boundary'
  const at = transport.startedAt + (boundary - transport.accumulatedMs)
  await h.write({
    startedAt: transport.startedAt,
    accumulatedMs: transport.accumulatedMs,
    skippedMs: transport.skippedMs ?? 0,
    jump: { at, toMs: target.startMs, label: target.label },
    loop: null,
  })
  // At the moment it will happen, from the section it leaves to the target.
  recordSection({ action: 'jump', at, fromLabel: sectionAt(sections, boundary - 1)?.label, toLabel: target.label, fromMs: boundary, toMs: target.startMs })
  return 'queued'
}

/** Calls off a queued jump - unless it is too close to undo. */
export async function cancelSectionJump(): Promise<void> {
  const h = host()
  const jump = h.transport.jump
  if (!h.allowed || !jump || jump.at - h.now() < CANCEL_MIN_MS) return
  await h.write({ jump: null })
  recordSection({ action: 'jump-cancelled', toLabel: jump.label })
}

/** Repeats `section` until released (null). Released, the song runs on past the section end; a
 * way back already queued stays only when it is too close to undo. */
export async function setSectionLoop(section: ShowSection | null): Promise<void> {
  const h = host()
  if (!h.allowed) return
  if (section) {
    if (section.endMs === null) return
    await h.write({ loop: { startMs: section.startMs, endMs: section.endMs, label: section.label } })
    recordSection({ action: 'repeat', fromLabel: section.label, fromMs: section.startMs, toMs: section.endMs })
    return
  }
  const jump = h.transport.jump
  const loop = h.loop
  const dropJump = jump && loop && jump.toMs === loop.startMs && jump.at - h.now() >= CANCEL_MIN_MS
  await h.write(dropJump ? { loop: null, jump: null } : { loop: null })
  if (loop) recordSection({ action: 'repeat-end', fromLabel: loop.label })
}

/** One look at jump and loop: folds a passed jump into the clock's anchor, and while a section
 * loops, queues the way back before the pass ends. */
function driveJump(h: JumpHost): void {
  const { transport, loop } = h
  if (transport.status !== 'playing' || transport.startedAt === null) return
  const now = h.now()
  if (transport.jump && now >= transport.jump.at) {
    const folded = foldJump(transport, now)
    void h.write({ startedAt: folded.startedAt, accumulatedMs: folded.accumulatedMs, skippedMs: folded.skippedMs ?? 0, jump: null })
    return
  }
  if (!loop || transport.jump) return
  const untilEnd = loop.endMs - computeActiveMs(transport, now)
  if (untilEnd <= 0 || untilEnd > LOOP_NOTICE_MS) return
  void h.write({ jump: { at: transport.startedAt + (loop.endMs - transport.accumulatedMs), toMs: loop.startMs, label: loop.label } })
}

/**
 * Gig: on the device that drives the automatic steps (drivesAutomation). Solo: always, on this
 * device's own practice state.
 */
export function useSectionJumpDriver(): void {
  useEffect(() => {
    const timer = setInterval(() => {
      if (drivesAutomation(useShowStateStore.getState())) driveJump(gigHost())
      if (useAppModeStore.getState().mode === 'practice') driveJump(practiceHost())
    }, DRIVER_TICK_MS)
    return () => clearInterval(timer)
  }, [])
}
