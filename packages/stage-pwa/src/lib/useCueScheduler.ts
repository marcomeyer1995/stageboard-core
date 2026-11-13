import { jumpBoundaryMs, type SectionJump } from './playbackTransport'
import { chaseCues } from './cueChase'
import { useEffect, useRef } from 'react'
import type { ShowCue } from 'shared-types'
import { cueLatencyMs } from './capabilityTiming'
import { usePracticeDevices } from './usePracticeRoute'
import { getServerTime } from './clockSync'
import { fireCue } from './cueFiring'
import { CUE_LOOKAHEAD_MS, CUE_TICK_MS, cuesToSchedule, passedCueIds, songTimeAt, type CueTransport } from './cueSchedule'
import { recordHandover, recordTick } from './cueTimingStats'
import { useShowModeSong } from './showMode'
import { recallScheduledMidi } from './webMidiOutput'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'
import { useShowLogStore } from '../store/useShowLogStore'
import { DEFAULT_PRACTICE_STATE, usePracticeStateStore } from '../store/usePracticeStateStore'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

/**
 * Per-tablet ahead-of-time cue dispatch (#102, runtime counterpart to #99's `ShowCue` schema).
 * Every tablet in the workspace runs this same hook off the same synced clock; only the one
 * actually bound to a given cue's `targetLogicalDeviceId` does anything - no relay, no network
 * call, matching docs/00 §6.
 *
 * While practising (#799 step 4) cues go out only when the device practises by a setup ("Ausgang
 * beim Üben"), and only to the gear that setup routes onto this device - one's own effects unit at
 * home. Nothing goes to the Stage-Server or to another tablet, and nothing into the Nachbericht.
 * The song runs on this device's own clock there (Date.now, with the loop trainer's speed); the
 * send moment is converted to server time on handover. A take that starts inside the song first
 * sends the states the song holds there (chase, as at a section jump) - practising the chorus
 * starts with the chorus rig.
 *
 * Since #477 it no longer fires a cue when a rendered frame notices it was crossed (up to a frame
 * late, far more on a busy tablet). A timer looks CUE_LOOKAHEAD_MS ahead and hands each cue over
 * with its server-time due moment (`cueSchedule.ts`): local MIDI goes out at that moment through a
 * WebMIDI timestamp, a Stage-Server cue is held by the gateway until then, anything else waits for
 * it in cueFiring.ts. Each cue is sent its output's latency early (docs/21 §3, `cueLatencyMs`). The due moment comes straight from the transport anchor (startedAt +
 * timeMs - accumulatedMs), so a cue at 0:00 also lands on song time 0 after the Play lead
 * (docs/19), not at the Play press.
 */
export function useCueScheduler(): void {
  const { mode, queue } = useShowModeSong()
  const gig = mode === 'gig'
  const gigStatus = useShowStateStore((state) => state.state.playbackStatus)
  const gigStartedAt = useShowStateStore((state) => state.state.playbackStartedAt)
  const gigAccumulatedMs = useShowStateStore((state) => state.state.playbackAccumulatedMs)
  // A queued section jump (#479): cues up to its boundary, then the target's - on time, and again
  // on every pass of a looped section.
  const gigJump = useShowStateStore((state) => state.state.playbackJump ?? null)
  const workspaceId = useWorkspaceStore((state) => state.activeWorkspaceId)
  const practice = usePracticeStateStore((state) => state.byWorkspace[workspaceId] ?? DEFAULT_PRACTICE_STATE)
  const status = gig ? gigStatus : practice.playbackStatus
  const startedAt = gig ? gigStartedAt : practice.playbackStartedAt
  const accumulatedMs = gig ? gigAccumulatedMs : practice.playbackAccumulatedMs
  const jump: SectionJump | null = gig ? gigJump : (practice.playbackJump ?? null)
  // The loop trainer's speed (#683) - Solo only.
  const rate = gig ? 1 : (practice.playbackRate ?? 1)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const activeEntryStartedAt = useShowStateStore((state) => state.state.activeEntryStartedAt)
  // Server cues go out once - from the device that drives the automatic steps (one device even in
  // Pro-Person mode, drivesAutomation, #453).
  const isMaster = useShowStateStore(drivesAutomation)
  const gigDevices = useLogicalDevicesStore((state) => state.devices)
  // Practising: as the chosen setup routes them - null without one, then nothing is sent.
  const practiceDevices = usePracticeDevices()
  const logicalDevices = gig ? gigDevices : practiceDevices
  const installed = usePluginsStore((state) => state.installed)
  const latencyProfiles = useLatencyProfilesStore((state) => state.profiles)

  // Keyed on activeEntryStartedAt, not activeEntryId: stable across a Pause/Resume cycle (so
  // resuming never re-fires an already-crossed cue), but a fresh, distinct value on every
  // genuine rearm - a Stop/Reset followed by Play on the *same* entry (queue.ts's REARM_PATCH
  // clears it to null, playSong sets a new one), or advancing to a different entry
  // (activateEntry always sets a fresh one too).
  const firedRef = useRef<{ sessionKey: number | string | null; ids: Set<string> }>({ sessionKey: null, ids: new Set() })
  // Practising has no activeEntryStartedAt: a take is every Play, resume or seek there - a new
  // anchor that is not a folded jump.
  const practiceTakeRef = useRef<{ startedAt: number | null; variantId: string | undefined; key: number }>({ startedAt: null, variantId: undefined, key: 0 })
  // Where the song last stood while practising - what the gear still holds when the next take starts.
  const practiceStoodRef = useRef<{ variantId: string | undefined; ms: number }>({ variantId: undefined, ms: 0 })
  // Cues whose MIDI was handed to WebMIDI for a moment still ahead (id -> send server time).
  const scheduledRef = useRef(new Map<string, number>())
  // The target's cues already handed over for a queued jump - its own list, so a repeated section's
  // cues go out again. Becomes the normal list once the jump is folded into the anchor.
  const jumpFiredRef = useRef<{ at: number; ids: Set<string> } | null>(null)

  const cues: readonly ShowCue[] | undefined = queue.currentVariant?.cues
  const song = queue.currentSong
  const variantId = queue.currentVariant?.id

  useEffect(() => {
    if (status !== 'playing' || !cues || cues.length === 0 || !logicalDevices) return
    const transport: CueTransport = { status, startedAt, accumulatedMs, ...(rate === 1 ? {} : { rate }) }
    // The Gig runs on band time, practising on this device's own clock.
    const clock = gig ? getServerTime : Date.now
    const toServerTime = (at: number) => (gig ? at : at + (getServerTime() - Date.now()))
    const capabilityOf = (cue: ShowCue) => logicalDevices.find((device) => device.id === cue.targetLogicalDeviceId)?.capability
    const fireContext = { deviceId, logicalDevices, installed, sendsServerCues: gig && isMaster }

    let sessionKey: number | string | null = activeEntryStartedAt
    if (!gig) {
      const take = practiceTakeRef.current
      const pending = jumpFiredRef.current
      const justFolded = pending !== null && (!jump || jump.at !== pending.at) && startedAt === pending.at
      if (take.variantId !== variantId || (take.startedAt !== startedAt && !justFolded)) take.key += 1
      take.startedAt = startedAt
      take.variantId = variantId
      sessionKey = `practice:${take.key}`
    }
    if (firedRef.current.sessionKey !== sessionKey) {
      // A new take - but this device may be joining mid-song (a late reconnect, a Master handoff,
      // an app reload): only cues still ahead of the current position may fire.
      firedRef.current = { sessionKey, ids: new Set(passedCueIds(cues, transport, clock())) }
      scheduledRef.current.clear()
      jumpFiredRef.current = null
      if (!gig) {
        // Practising starts anywhere in the song: the states it holds here go out first, unless the
        // gear already has them from where the song last stood.
        const stood = practiceStoodRef.current
        const position = songTimeAt(transport, clock())
        for (const cue of chaseCues(cues, stood.variantId === variantId ? stood.ms : 0, position, capabilityOf)) void fireCue(cue, fireContext)
        practiceStoodRef.current = { variantId, ms: position }
      }
    }
    // The jump has been folded into the anchor: now in the target's song time, everything before
    // the target counts as passed, plus what was already sent for it.
    const folded = jumpFiredRef.current
    if (folded && (!jump || jump.at !== folded.at)) {
      if (startedAt === folded.at) firedRef.current.ids = new Set([...cues.filter((cue) => cue.timeMs < accumulatedMs).map((cue) => cue.id), ...folded.ids])
      jumpFiredRef.current = null
    }
    if (jump && jumpFiredRef.current?.at !== jump.at) jumpFiredRef.current = { at: jump.at, ids: new Set() }
    const boundaryMs = jump ? jumpBoundaryMs({ status, startedAt, accumulatedMs, jump, ...(rate === 1 ? {} : { rate }) }) : null
    const before = boundaryMs === null ? cues : cues.filter((cue) => cue.timeMs < boundaryMs)
    const after = jump && boundaryMs !== null ? cues.filter((cue) => cue.timeMs >= jump.toMs) : []
    const afterRate = jump?.rate ?? rate
    const afterTransport: CueTransport | null = jump ? { status, startedAt: jump.at, accumulatedMs: jump.toMs, ...(afterRate === 1 ? {} : { rate: afterRate }) } : null
    // State cues to send again right at the jump (chase, cueChase.ts): the rig or patch the target
    // needs when it differs from where the song stands.
    const chased = jump && boundaryMs !== null ? chaseCues(cues, boundaryMs, jump.toMs, capabilityOf) : []

    // How late each tick comes and each cue is handed over (Diagnose tab, `cueTimingStats.ts`).
    let lastTick: number | null = null
    const tick = () => {
      const tickAt = performance.now()
      if (lastTick !== null) recordTick(tickAt - lastTick)
      lastTick = tickAt
      const fired = firedRef.current.ids
      const now = clock()
      if (!gig) practiceStoodRef.current = { variantId, ms: jump && now >= jump.at && afterTransport ? songTimeAt(afterTransport, now) : songTimeAt(transport, now) }
      const latencyMs = (cue: ShowCue) => cueLatencyMs(cue, logicalDevices, installed, latencyProfiles)
      const jumpFired = jumpFiredRef.current
      const chaseDue =
        jump && jumpFired
          ? chased
              .filter((cue) => !jumpFired.ids.has(`chase:${cue.id}`))
              .map((cue) => ({ cue, dueAt: jump.at, sendAt: jump.at - latencyMs(cue) }))
              .filter((item) => item.sendAt <= now + CUE_LOOKAHEAD_MS)
          : []
      for (const item of chaseDue) jumpFired!.ids.add(`chase:${item.cue.id}`)
      const due = [
        ...chaseDue.map((item) => ({ ...item, firedIn: null as Set<string> | null })),
        ...cuesToSchedule(before, transport, now, fired, CUE_LOOKAHEAD_MS, latencyMs).map((item) => ({ ...item, firedIn: fired })),
        ...(afterTransport && jumpFiredRef.current
          ? cuesToSchedule(after, afterTransport, now, jumpFiredRef.current.ids, CUE_LOOKAHEAD_MS, latencyMs).map((item) => ({ ...item, firedIn: jumpFiredRef.current!.ids }))
          : []),
      ]
      for (const { cue, sendAt, firedIn } of due) {
        firedIn?.add(cue.id)
        recordHandover(now - sendAt)
        void fireCue(cue, { ...fireContext, timing: { scheduledAt: toServerTime(sendAt), serverNow: getServerTime } }).then((outcome) => {
          if (outcome?.scheduledLocally) scheduledRef.current.set(cue.id, sendAt)
          // Practising stays out of the Nachbericht.
          if (!gig) return
          // Into the Nachbericht (#8): every cue sent, failed ones with the reason. One id per
          // show + play-through + cue, so the same cue reported by two devices is one entry.
          const showId = useShowStateStore.getState().state.currentShowId
          if (!outcome || !showId || !song || activeEntryStartedAt === null) return
          void useShowLogStore.getState().append({
            id: `cue-${showId}-${activeEntryStartedAt}-${cue.id}`,
            showId,
            type: 'cue-fired',
            at: Date.now(),
            songId: song.id,
            songTitle: song.title,
            cueId: cue.id,
            ...(variantId ? { variantId } : {}),
            cueType: cue.type,
            target: outcome.target,
            ok: outcome.ok,
            ...(outcome.message ? { message: outcome.message.slice(0, 300) } : {}),
          })
        })
      }
    }
    tick()
    const timer = setInterval(tick, CUE_TICK_MS)
    return () => clearInterval(timer)
  }, [gig, status, startedAt, accumulatedMs, jump, rate, cues, song, variantId, activeEntryStartedAt, logicalDevices, installed, latencyProfiles, deviceId, isMaster])

  // When song time 0 lies, in server time - what really changes the moment of a cue. Folding a
  // passed section jump into the anchor (#479) keeps it, so cues sent for the target stay.
  const songZeroAt = startedAt === null ? null : jump ? jump.at - jump.toMs : startedAt - accumulatedMs
  // Pause/Stop/seek: MIDI already handed over for a moment that is now not coming. Where WebMIDI
  // can take it back (`MIDIOutput.clear()`), do, and let those cues fire again later; elsewhere
  // they still go out - the price of the short CUE_LOOKAHEAD_MS window (#477).
  useEffect(() => {
    const scheduled = scheduledRef.current
    return () => {
      const now = gig ? getServerTime() : Date.now()
      const stillAhead = [...scheduled].filter(([, dueAt]) => dueAt > now).map(([id]) => id)
      scheduled.clear()
      if (stillAhead.length > 0 && recallScheduledMidi()) {
        for (const id of stillAhead) firedRef.current.ids.delete(id)
      }
    }
  }, [gig, status, songZeroAt])
}
