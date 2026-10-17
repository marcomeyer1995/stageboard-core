import { jumpBoundaryMs } from './playbackTransport'
import { chaseCues } from './cueChase'
import { useEffect, useRef } from 'react'
import type { ShowCue } from 'shared-types'
import { cueLatencyMs } from './capabilityTiming'
import { getServerTime } from './clockSync'
import { fireCue } from './cueFiring'
import { CUE_LOOKAHEAD_MS, CUE_TICK_MS, cuesToSchedule, passedCueIds, type CueTransport } from './cueSchedule'
import { recordHandover, recordTick } from './cueTimingStats'
import { useShowModeSong } from './showMode'
import { recallScheduledMidi } from './webMidiOutput'
import { useLatencyProfilesStore } from '../store/useLatencyProfilesStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'
import { useShowLogStore } from '../store/useShowLogStore'

/**
 * Per-tablet ahead-of-time cue dispatch (#102, runtime counterpart to #99's `ShowCue` schema).
 * Every tablet in the workspace runs this same hook off the same synced clock; only the one
 * actually bound to a given cue's `targetLogicalDeviceId` does anything - no relay, no network
 * call, matching docs/00 §6.
 *
 * Gig mode only - Practice mode has no band/routing concept to route against, same reasoning
 * `ShowTransportWidget`'s Gig-vs-Practice split already uses for audio.
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
  const status = useShowStateStore((state) => state.state.playbackStatus)
  const startedAt = useShowStateStore((state) => state.state.playbackStartedAt)
  const accumulatedMs = useShowStateStore((state) => state.state.playbackAccumulatedMs)
  // A queued section jump (#479): cues up to its boundary, then the target's - on time, and again
  // on every pass of a looped section.
  const jump = useShowStateStore((state) => state.state.playbackJump ?? null)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const activeEntryStartedAt = useShowStateStore((state) => state.state.activeEntryStartedAt)
  // Server cues go out once - from the device that drives the automatic steps (one device even in
  // Pro-Person mode, drivesAutomation, #453).
  const isMaster = useShowStateStore(drivesAutomation)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const installed = usePluginsStore((state) => state.installed)
  const latencyProfiles = useLatencyProfilesStore((state) => state.profiles)

  // Keyed on activeEntryStartedAt, not activeEntryId: stable across a Pause/Resume cycle (so
  // resuming never re-fires an already-crossed cue), but a fresh, distinct value on every
  // genuine rearm - a Stop/Reset followed by Play on the *same* entry (queue.ts's REARM_PATCH
  // clears it to null, playSong sets a new one), or advancing to a different entry
  // (activateEntry always sets a fresh one too).
  const firedRef = useRef<{ sessionKey: number | null; ids: Set<string> }>({ sessionKey: null, ids: new Set() })
  // Cues whose MIDI was handed to WebMIDI for a moment still ahead (id -> send server time).
  const scheduledRef = useRef(new Map<string, number>())
  // The target's cues already handed over for a queued jump - its own list, so a repeated section's
  // cues go out again. Becomes the normal list once the jump is folded into the anchor.
  const jumpFiredRef = useRef<{ at: number; ids: Set<string> } | null>(null)

  const cues: readonly ShowCue[] | undefined = queue.currentVariant?.cues
  const song = queue.currentSong

  useEffect(() => {
    if (mode !== 'gig' || status !== 'playing' || !cues || cues.length === 0) return
    const transport: CueTransport = { status, startedAt, accumulatedMs }

    if (firedRef.current.sessionKey !== activeEntryStartedAt) {
      // A new take - but this device may be joining mid-song (a late reconnect, a Master handoff,
      // an app reload): only cues still ahead of the current position may fire.
      firedRef.current = { sessionKey: activeEntryStartedAt, ids: new Set(passedCueIds(cues, transport, getServerTime())) }
      scheduledRef.current.clear()
      jumpFiredRef.current = null
    }
    // The jump has been folded into the anchor: now in the target's song time, everything before
    // the target counts as passed, plus what was already sent for it.
    const folded = jumpFiredRef.current
    if (folded && (!jump || jump.at !== folded.at)) {
      if (startedAt === folded.at) firedRef.current.ids = new Set([...cues.filter((cue) => cue.timeMs < accumulatedMs).map((cue) => cue.id), ...folded.ids])
      jumpFiredRef.current = null
    }
    if (jump && jumpFiredRef.current?.at !== jump.at) jumpFiredRef.current = { at: jump.at, ids: new Set() }
    const boundaryMs = jump ? jumpBoundaryMs({ status, startedAt, accumulatedMs, jump }) : null
    const before = boundaryMs === null ? cues : cues.filter((cue) => cue.timeMs < boundaryMs)
    const after = jump && boundaryMs !== null ? cues.filter((cue) => cue.timeMs >= jump.toMs) : []
    const afterTransport: CueTransport | null = jump ? { status, startedAt: jump.at, accumulatedMs: jump.toMs } : null
    // State cues to send again right at the jump (chase, cueChase.ts): the rig or patch the target
    // needs when it differs from where the song stands.
    const capabilityOf = (cue: ShowCue) => logicalDevices.find((device) => device.id === cue.targetLogicalDeviceId)?.capability
    const chased = jump && boundaryMs !== null ? chaseCues(cues, boundaryMs, jump.toMs, capabilityOf) : []

    // How late each tick comes and each cue is handed over (Diagnose tab, `cueTimingStats.ts`).
    let lastTick: number | null = null
    const tick = () => {
      const tickAt = performance.now()
      if (lastTick !== null) recordTick(tickAt - lastTick)
      lastTick = tickAt
      const fired = firedRef.current.ids
      const now = getServerTime()
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
        void fireCue(cue, {
          deviceId,
          logicalDevices,
          installed,
          sendsServerCues: isMaster,
          timing: { scheduledAt: sendAt, serverNow: getServerTime },
        }).then((outcome) => {
          if (outcome?.scheduledLocally) scheduledRef.current.set(cue.id, sendAt)
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
  }, [mode, status, startedAt, accumulatedMs, jump, cues, song, activeEntryStartedAt, logicalDevices, installed, latencyProfiles, deviceId, isMaster])

  // When song time 0 lies, in server time - what really changes the moment of a cue. Folding a
  // passed section jump into the anchor (#479) keeps it, so cues sent for the target stay.
  const songZeroAt = startedAt === null ? null : jump ? jump.at - jump.toMs : startedAt - accumulatedMs
  // Pause/Stop/seek: MIDI already handed over for a moment that is now not coming. Where WebMIDI
  // can take it back (`MIDIOutput.clear()`), do, and let those cues fire again later; elsewhere
  // they still go out - the price of the short CUE_LOOKAHEAD_MS window (#477).
  useEffect(() => {
    const scheduled = scheduledRef.current
    return () => {
      const now = getServerTime()
      const stillAhead = [...scheduled].filter(([, dueAt]) => dueAt > now).map(([id]) => id)
      scheduled.clear()
      if (stillAhead.length > 0 && recallScheduledMidi()) {
        for (const id of stillAhead) firedRef.current.ids.delete(id)
      }
    }
  }, [status, songZeroAt])
}
