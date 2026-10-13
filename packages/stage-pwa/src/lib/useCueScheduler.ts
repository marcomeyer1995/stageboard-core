import { useEffect, useRef } from 'react'
import type { ShowCue } from 'shared-types'
import { getServerTime } from './clockSync'
import { fireCue } from './cueFiring'
import { CUE_TICK_MS, cuesToSchedule, passedCueIds, type CueTransport } from './cueSchedule'
import { useShowModeSong } from './showMode'
import { recallScheduledMidi } from './webMidiOutput'
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
 * it in cueFiring.ts. The due moment comes straight from the transport anchor (startedAt +
 * timeMs - accumulatedMs), so a cue at 0:00 also lands on song time 0 after the Play lead
 * (docs/19), not at the Play press.
 */
export function useCueScheduler(): void {
  const { mode, queue } = useShowModeSong()
  const status = useShowStateStore((state) => state.state.playbackStatus)
  const startedAt = useShowStateStore((state) => state.state.playbackStartedAt)
  const accumulatedMs = useShowStateStore((state) => state.state.playbackAccumulatedMs)
  const deviceId = useShowStateStore((state) => state.deviceId)
  const activeEntryStartedAt = useShowStateStore((state) => state.state.activeEntryStartedAt)
  // Server cues go out once - from the device that drives the automatic steps (one device even in
  // Pro-Person mode, drivesAutomation, #453).
  const isMaster = useShowStateStore(drivesAutomation)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const installed = usePluginsStore((state) => state.installed)

  // Keyed on activeEntryStartedAt, not activeEntryId: stable across a Pause/Resume cycle (so
  // resuming never re-fires an already-crossed cue), but a fresh, distinct value on every
  // genuine rearm - a Stop/Reset followed by Play on the *same* entry (queue.ts's REARM_PATCH
  // clears it to null, playSong sets a new one), or advancing to a different entry
  // (activateEntry always sets a fresh one too).
  const firedRef = useRef<{ sessionKey: number | null; ids: Set<string> }>({ sessionKey: null, ids: new Set() })
  // Cues whose MIDI was handed to WebMIDI for a moment still ahead (id -> due server time).
  const scheduledRef = useRef(new Map<string, number>())

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
    }

    const tick = () => {
      const fired = firedRef.current.ids
      for (const { cue, dueAt } of cuesToSchedule(cues, transport, getServerTime(), fired)) {
        fired.add(cue.id)
        void fireCue(cue, {
          deviceId,
          logicalDevices,
          installed,
          sendsServerCues: isMaster,
          timing: { scheduledAt: dueAt, serverNow: getServerTime },
        }).then((outcome) => {
          if (outcome?.scheduledLocally) scheduledRef.current.set(cue.id, dueAt)
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
  }, [mode, status, startedAt, accumulatedMs, cues, song, activeEntryStartedAt, logicalDevices, installed, deviceId, isMaster])

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
  }, [status, startedAt, accumulatedMs])
}
