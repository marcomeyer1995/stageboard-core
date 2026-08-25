import { useEffect } from 'react'
import { create } from 'zustand'
import { currentLineIndex, nextSectionIndex, parseChordPro } from './chordpro'
import { getQueueSnapshot } from './queue'
import { isWebMidiSupported, listenForMidiTriggers } from './webMidi'
import { useClockStore } from '../store/useClockStore'

export type MidiStatus = 'unsupported' | 'no-device' | 'connected'

const useMidiStatusStore = create<{ status: MidiStatus }>(() => ({
  status: isWebMidiSupported() ? 'no-device' : 'unsupported',
}))

/**
 * Jumps playback to the next song part (Verse -> Chorus, as in docs/04), or to the next
 * line in songs that define no parts - independent of real elapsed time. This is the
 * manual "Umblättern" mode from docs/07 (No-Timecode Modus), layered on top of the same
 * Section Highlighting the Master-Clock already drives.
 */
export function jumpToNextSection(): void {
  const currentSong = getQueueSnapshot().currentSong
  if (!currentSong) return
  const lines = parseChordPro(currentSong.chordProContent)
  const elapsedMs = useClockStore.getState().getElapsedMs()
  const index = currentLineIndex(lines, elapsedMs)
  const next = nextSectionIndex(lines, index)
  if (next !== null) {
    useClockStore.getState().seek(lines[next].timeMs!)
  }
}

/**
 * One WebMIDI subscription for the whole app, reference-counted across mounts. Several
 * components ask about the foot switch (the status widget, the capability resolver); each
 * opening its own listener would fire jumpToNextSection once per listener and skip parts.
 */
let handle: Awaited<ReturnType<typeof listenForMidiTriggers>> = null
let subscribers = 0

async function acquire(): Promise<void> {
  subscribers += 1
  if (subscribers > 1 || handle) return

  const opened = await listenForMidiTriggers(jumpToNextSection)
  if (subscribers === 0) {
    // Everyone unmounted while we were waiting for MIDI permission.
    opened?.stop()
    return
  }
  handle = opened
  useMidiStatusStore.setState({
    status: !opened ? 'unsupported' : opened.inputCount > 0 ? 'connected' : 'no-device',
  })
}

function release(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  handle?.stop()
  handle = null
}

/**
 * Wires "Generic WebMIDI Input" (a real foot controller, or nothing at all - both are
 * fine) to the Master-Clock. No device attached is a normal state, not an error.
 */
export function useMidiTrigger() {
  const status = useMidiStatusStore((state) => state.status)

  useEffect(() => {
    void acquire()
    return release
  }, [])

  return { status, jumpToNextSection }
}
