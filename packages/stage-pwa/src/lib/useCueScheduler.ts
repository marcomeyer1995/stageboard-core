import { useEffect, useRef } from 'react'
import { fireCue } from './cueFiring'
import { useShowElapsed, useShowMode } from './showMode'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { drivesAutomation, useShowStateStore } from '../store/useShowStateStore'
import { useShowLogStore } from '../store/useShowLogStore'

/**
 * Per-tablet ahead-of-time cue dispatch (#102, runtime counterpart to #99's `ShowCue` schema) -
 * watches the same synced elapsed time `ShowTransportWidget`/the Prompter already read, and
 * fires whichever of the current variant's cues just got crossed (`cueFiring.ts`'s `fireCue`).
 * Every tablet in the workspace runs this same hook off the same synced clock; only the one
 * actually bound to a given cue's `targetLogicalDeviceId` does anything - no relay, no network
 * call, matching docs/00 §6.
 *
 * Gig mode only - Practice mode has no band/routing concept to route against, same reasoning
 * `ShowTransportWidget`'s Gig-vs-Practice split already uses for audio.
 *
 * Reacts to the position crossing a cue's `timeMs`, checked every frame (a plain polling comparison,
 * not literal sample-accurate ahead-of-time dispatch per docs/00 §4's sub-5ms rules - the same
 * ~60fps precision `usePlaybackElapsedMs`'s own requestAnimationFrame loop already offers
 * everywhere else cues/timecodes are read in this app).
 */
export function useCueScheduler(): void {
  const { mode, queue, elapsedNow } = useShowMode()
  // Checked every frame, rendered only when one more cue lies behind the position (or playback
  // starts/stops) - the same frame a cue is crossed, without re-rendering 60 times a second (#457).
  const cueTimes = queue.currentVariant?.cues
  const passed = useShowElapsed((ms) => (ms === null ? -1 : (cueTimes ?? []).filter((cue) => cue.timeMs <= ms).length))
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

  useEffect(() => {
    const elapsedMs = elapsedNow()
    if (mode !== 'gig' || passed < 0 || elapsedMs === null) return
    const cues = queue.currentVariant?.cues ?? []
    if (cues.length === 0) return

    if (firedRef.current.sessionKey !== activeEntryStartedAt) {
      // A new take just started - but this device may be joining mid-song (a late reconnect,
      // a Master handoff, an app reload): only cues still ahead of the current position should
      // ever fire, so pre-mark anything already behind us as "fired" rather than firing it now.
      const alreadyPassed = cues.filter((cue) => cue.timeMs <= elapsedMs).map((cue) => cue.id)
      firedRef.current = { sessionKey: activeEntryStartedAt, ids: new Set(alreadyPassed) }
    }

    for (const cue of cues) {
      if (cue.timeMs > elapsedMs || firedRef.current.ids.has(cue.id)) continue
      firedRef.current.ids.add(cue.id)
      const song = queue.currentSong
      void fireCue(cue, { deviceId, logicalDevices, installed, sendsServerCues: isMaster }).then((outcome) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- elapsedNow reads the position; `passed` is what changes
  }, [mode, passed, queue.currentVariant, queue.currentSong, activeEntryStartedAt, logicalDevices, installed, deviceId, isMaster])
}
