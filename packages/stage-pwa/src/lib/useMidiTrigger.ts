import { useCallback, useEffect, useState } from 'react'
import { currentLineIndex, nextSectionIndex, parseChordPro } from './chordpro'
import { getQueueSnapshot } from './queue'
import { isWebMidiSupported, listenForMidiTriggers } from './webMidi'
import { useClockStore } from '../store/useClockStore'

export type MidiStatus = 'unsupported' | 'no-device' | 'connected'

/**
 * Wires "Generic WebMIDI Input" (a real foot controller, or nothing at all -
 * both are fine) to the Master-Clock: any trigger jumps playback straight to
 * the next song part (Verse -> Chorus, as in docs/04), or to the next line in
 * songs that define no parts - independent of real elapsed time. This is the
 * manual "Umblättern" mode from docs/07 (No-Timecode Modus), layered on top
 * of the same Section Highlighting the Master-Clock already drives.
 */
export function useMidiTrigger() {
  const [status, setStatus] = useState<MidiStatus>(
    isWebMidiSupported() ? 'no-device' : 'unsupported',
  )

  const jumpToNextSection = useCallback(() => {
    const currentSong = getQueueSnapshot().currentSong
    if (!currentSong) return
    const lines = parseChordPro(currentSong.chordProContent)
    const elapsedMs = useClockStore.getState().getElapsedMs()
    const index = currentLineIndex(lines, elapsedMs)
    const next = nextSectionIndex(lines, index)
    if (next !== null) {
      useClockStore.getState().seek(lines[next].timeMs!)
    }
  }, [])

  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false

    listenForMidiTriggers(jumpToNextSection).then((handle) => {
      if (cancelled) {
        handle?.stop()
        return
      }
      if (!handle) {
        setStatus('unsupported')
        return
      }
      stop = handle.stop
      setStatus(handle.inputCount > 0 ? 'connected' : 'no-device')
    })

    return () => {
      cancelled = true
      stop?.()
    }
  }, [jumpToNextSection])

  return { status, jumpToNextSection }
}
