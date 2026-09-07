import { useEffect, useRef } from 'react'
import { fireCue } from './cueFiring'
import { useShowMode } from './showMode'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'
import { useShowStateStore } from '../store/useShowStateStore'

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
 * Reacts to `elapsedMs` crossing a cue's `timeMs` on every render (a plain polling comparison,
 * not literal sample-accurate ahead-of-time dispatch per docs/00 §4's sub-5ms rules - the same
 * ~60fps precision `usePlaybackElapsedMs`'s own requestAnimationFrame loop already offers
 * everywhere else cues/timecodes are read in this app).
 */
export function useCueScheduler(): void {
  const { mode, queue, elapsedMs } = useShowMode()
  const deviceId = useShowStateStore((state) => state.deviceId)
  const activeEntryStartedAt = useShowStateStore((state) => state.state.activeEntryStartedAt)
  const logicalDevices = useLogicalDevicesStore((state) => state.devices)
  const installed = usePluginsStore((state) => state.installed)

  // Keyed on activeEntryStartedAt, not activeEntryId: stable across a Pause/Resume cycle (so
  // resuming never re-fires an already-crossed cue), but a fresh, distinct value on every
  // genuine rearm - a Stop/Reset followed by Play on the *same* entry (queue.ts's REARM_PATCH
  // clears it to null, playSong sets a new one), or advancing to a different entry
  // (activateEntry always sets a fresh one too).
  const firedRef = useRef<{ sessionKey: number | null; ids: Set<string> }>({ sessionKey: null, ids: new Set() })

  useEffect(() => {
    if (mode !== 'gig' || elapsedMs === null) return
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
      void fireCue(cue, { deviceId, logicalDevices, installed })
    }
  }, [mode, elapsedMs, queue.currentVariant, activeEntryStartedAt, logicalDevices, installed, deviceId])
}
