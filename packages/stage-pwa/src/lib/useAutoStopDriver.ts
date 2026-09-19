import { useEffect, useRef } from 'react'
import { isSongEntry } from 'shared-types'
import { songDurationMs } from './entryDuration'
import { resolveTrackForEntry } from './computeQueue'
import { resolveTrackEndAction, transitionItemEndMs } from './trackEndTransition'
import { getLocalTrackDurationMs } from './localAudioEngine'
import { useShowMode } from './showMode'

/**
 * Ends the current entry once its length has elapsed (#231, #28), then acts on its
 * `transitionType` (#232, trackEndTransition.ts) - mounted once, unconditionally, in App.tsx, same
 * reasoning as useAudioOutputDriver.ts/useClickOutputDriver.ts (a widget-local effect would stop
 * working the moment its tab is switched away from).
 *
 * The length comes from stored data (entryDuration.ts), not from whichever tablet has the audio
 * loaded, so it works identically in Gig and Practice through useShowMode.ts's shared API and
 * only needs `canControl` (Gig's Master-Token, always-true in Practice) - Master and the audio
 * tablet no longer have to be the same device, and a click-only song with a hand-entered length
 * stops too. Only a track with no stored length yet falls back to the loaded audio's own length.
 *
 * `manual` stops; `next-ready` advances to the next entry without playing it; `seamless`
 * advances and starts it at once (no count-in; useAudioOutputDriver.ts preloads its track so the
 * swap has no load gap); `delayed` advances and starts it after the entry's `transitionDelayMs`.
 * A transition item or section heading (#29) plays as a silent countdown of its own duration and
 * ends the same way. #231's bar-extend trigger needs no special handling: it already pushes the
 * end point this driver waits for, so it delays the handoff too.
 */
export function useAutoStopDriver(): void {
  const { elapsedMs, playbackStatus, canControl, clickExtendMs, stop, next, play, queue, trackOverride } = useShowMode()
  const { currentEntry, currentVariant, nextEntry } = queue

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
    // A song ends after its stored length (#28: the selected track's, else the hand-entered one -
    // which also ends click-only songs); a track whose length isn't stored yet falls back to the
    // audio actually loaded on this device. A song with no known length never stops by itself. A
    // transition item or section heading (#29) ends after its own duration.
    const durationMs =
      currentEntry && isSongEntry(currentEntry)
        ? (songDurationMs(currentEntry, currentVariant, trackOverride)?.ms ??
          (resolveTrackForEntry(currentEntry, currentVariant, trackOverride) ? getLocalTrackDurationMs() : null))
        : transitionItemEndMs(currentEntry)
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
  }, [playbackStatus, canControl, elapsedMs, clickExtendMs, stop, next, currentEntry, currentVariant, trackOverride, nextEntry])

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
