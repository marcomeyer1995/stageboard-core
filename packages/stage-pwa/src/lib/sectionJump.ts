import { useEffect } from 'react'
import { getServerTime } from './clockSync'
import { computeActiveMs, foldJump, transportOf } from './playbackTransport'
import { jumpBoundary, type JumpWhen, type ShowSection } from './showSections'
import type { ClickTimeline } from './beatGrid'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'

/**
 * Section jump and loop in the show (#479, docs/20 §4). The master queues a jump; it happens on a
 * bar or section boundary at least JUMP_NOTICE_MS ahead, so every device learns of it in time and
 * click, track and cues continue at the target exactly on the beat. Gig only for now - Solo Üben
 * follows once its track runs on Web Audio too (Marco, 2026-10-17).
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

/** Queues a jump to `target` at the next bar line or the end of the section playing. Replaces a
 * jump queued before and ends a loop. */
export async function queueSectionJump(target: ShowSection, when: JumpWhen, sections: readonly ShowSection[], timeline: ClickTimeline): Promise<JumpResult> {
  const { isMaster, state, applyPatch } = useShowStateStore.getState()
  if (!isMaster) return 'not-master'
  if (state.playbackStatus !== 'playing' || state.playbackStartedAt === null) return 'not-playing'
  const now = getServerTime()
  const transport = foldJump(transportOf(state), now)
  if (transport.startedAt === null) return 'not-playing'
  const boundary = jumpBoundary(when, computeActiveMs(transport, now) + JUMP_NOTICE_MS, sections, timeline)
  if (boundary === null) return 'no-boundary'
  await applyPatch({
    playbackStartedAt: transport.startedAt,
    playbackAccumulatedMs: transport.accumulatedMs,
    playbackJump: { at: transport.startedAt + (boundary - transport.accumulatedMs), toMs: target.startMs, label: target.label },
    playbackLoop: null,
  })
  return 'queued'
}

/** Calls off a queued jump - unless it is too close to undo. */
export async function cancelSectionJump(): Promise<void> {
  const { isMaster, state, applyPatch } = useShowStateStore.getState()
  const jump = state.playbackJump
  if (!isMaster || !jump || jump.at - getServerTime() < CANCEL_MIN_MS) return
  await applyPatch({ playbackJump: null })
}

/** Repeats `section` until released (null). Released, the song runs on past the section end; a
 * way back already queued stays only when it is too close to undo. */
export async function setSectionLoop(section: ShowSection | null): Promise<void> {
  const { isMaster, state, applyPatch } = useShowStateStore.getState()
  if (!isMaster) return
  if (section) {
    if (section.endMs === null) return
    await applyPatch({ playbackLoop: { startMs: section.startMs, endMs: section.endMs, label: section.label } })
    return
  }
  const jump = state.playbackJump
  const loop = state.playbackLoop
  const dropJump = jump && loop && jump.toMs === loop.startMs && jump.at - getServerTime() >= CANCEL_MIN_MS
  await applyPatch(dropJump ? { playbackLoop: null, playbackJump: null } : { playbackLoop: null })
}

/**
 * On the device that drives the automatic steps (drivesAutomation): folds a passed jump into the
 * song clock's anchor, and while a section loops, queues the way back before every pass ends.
 */
export function useSectionJumpDriver(): void {
  useEffect(() => {
    const timer = setInterval(() => {
      const store = useShowStateStore.getState()
      const { state, applyPatch } = store
      if (!drivesAutomation(store) || state.playbackStatus !== 'playing' || state.playbackStartedAt === null) return
      const now = getServerTime()
      const transport = transportOf(state)
      if (state.playbackJump && now >= state.playbackJump.at) {
        const folded = foldJump(transport, now)
        void applyPatch({ playbackStartedAt: folded.startedAt, playbackAccumulatedMs: folded.accumulatedMs, playbackJump: null })
        return
      }
      const loop = state.playbackLoop
      if (!loop || state.playbackJump) return
      const untilEnd = loop.endMs - computeActiveMs(transport, now)
      if (untilEnd <= 0 || untilEnd > LOOP_NOTICE_MS) return
      void applyPatch({ playbackJump: { at: state.playbackStartedAt + (loop.endMs - state.playbackAccumulatedMs), toMs: loop.startMs, label: loop.label } })
    }, DRIVER_TICK_MS)
    return () => clearInterval(timer)
  }, [])
}
