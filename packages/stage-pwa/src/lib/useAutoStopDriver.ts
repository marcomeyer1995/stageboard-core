import { useEffect, useRef } from 'react'
import { isSongEntry } from 'shared-types'
import { resolveTrackEndAction, transitionItemEndMs } from './trackEndTransition'
import { getLocalTrackDurationMs } from './localAudioEngine'
import { useShowMode } from './showMode'

/**
 * Auto-stops playback once the current entry's backing track reaches its natural end (#231) -
 * mounted once, unconditionally, in App.tsx, same reasoning as useAudioOutputDriver.ts/
 * useClickOutputDriver.ts (a widget-local effect would stop working the moment its tab is
 * switched away from).
 *
 * Works identically in both Gig and Practice mode purely through useShowMode.ts's shared API,
 * with no explicit "is this the audio-output device" check needed: `getLocalTrackDurationMs()`
 * (localAudioEngine.ts) is naturally `null` on any Gig-mode tablet that hasn't itself loaded the
 * track - only useAudioOutputDriver.ts's claimed-output tablet ever calls `loadLocalTrack` there
 * - and Practice mode always plays locally on this exact device. Combined with `canControl`
 * (Gig's Master-Token, always-true in Practice), the auto-stop fires exactly on whichever single
 * device happens to satisfy both. The one real gap this leaves: a Gig-mode setup where Master
 * and the claimed audio output are two different tablets never auto-stops, since neither one
 * alone satisfies both conditions - the same class of limitation useAudioOutputDriver.ts's "only
 * Master forwards a load event" already has, and out of scope to solve here (it would need
 * broadcasting duration into ShowState, real cross-device plumbing this issue doesn't ask for).
 *
 * A transition item (#29) plays like a silent track whose length is its estimated duration, so the
 * same handoff applies at the end of its countdown. What happens at that end depends on the
 * entry's `transitionType` (#232, trackEndTransition.ts):
 * `manual` stops, `next-ready` advances to the next entry without playing it, `seamless`
 * advances and starts it at once (no count-in; useAudioOutputDriver.ts preloads its track so the
 * swap has no load gap), `delayed` advances and starts it after the entry's `transitionDelayMs`.
 * #231's bar-extend trigger needs no special handling: it already pushes the end point this
 * driver waits for, so it delays the handoff too.
 */
export function useAutoStopDriver(): void {
  const { elapsedMs, playbackStatus, canControl, clickExtendMs, stop, next, play, queue } = useShowMode()
  const { currentEntry, nextEntry } = queue

  // Guards against firing the end action more than once for the same play-through: `elapsedMs`
  // keeps ticking via requestAnimationFrame for a frame or two after it fires, before the
  // resulting ShowState/PracticeState change actually flips `playbackStatus` back out of
  // 'playing' - same pattern useAudioOutputDriver.ts's `audioStartedForRunRef` already uses.
  const handledForRunRef = useRef(false)
  // Set just before advancing, consumed once the queue has actually moved to that entry.
  const pendingStartRef = useRef<{ entryId: string; skipCountIn: boolean; delayMs: number } | null>(null)

  useEffect(() => {
    if (playbackStatus !== 'playing') {
      handledForRunRef.current = false
      return
    }
    if (!canControl || handledForRunRef.current || elapsedMs === null) return
    // A song ends with its loaded backing track; a transition item (#29) with its own countdown.
    // Sections and `manual` items have no scheduled end - "Weiter" moves on from those.
    const durationMs =
      currentEntry && isSongEntry(currentEntry) ? getLocalTrackDurationMs() : transitionItemEndMs(currentEntry)
    if (durationMs === null || elapsedMs < durationMs + clickExtendMs) return
    handledForRunRef.current = true
    const action = resolveTrackEndAction(currentEntry, nextEntry)
    if (action.kind === 'stop') {
      void stop()
      return
    }
    if (action.kind === 'start-next' && nextEntry) {
      pendingStartRef.current = { entryId: nextEntry.id, skipCountIn: action.skipCountIn, delayMs: action.delayMs }
    }
    void next()
  }, [playbackStatus, canControl, elapsedMs, clickExtendMs, stop, next, currentEntry, nextEntry])

  const currentEntryId = currentEntry?.id ?? null
  useEffect(() => {
    const pending = pendingStartRef.current
    if (!pending || pending.entryId !== currentEntryId) return
    if (playbackStatus !== 'stopped') {
      pendingStartRef.current = null // someone else already acted (e.g. pressed Play themselves)
      return
    }
    // A timer even for 0 ms: lets the audio-output driver's load effect for the new entry run
    // first, so `play` never races ahead of the track swap it depends on.
    const timer = setTimeout(() => {
      pendingStartRef.current = null
      void play({ skipCountIn: pending.skipCountIn })
    }, pending.delayMs)
    return () => clearTimeout(timer)
  }, [currentEntryId, playbackStatus, play])
}
