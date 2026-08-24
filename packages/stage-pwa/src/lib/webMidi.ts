export function isWebMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
}

interface MidiListenHandle {
  inputCount: number
  stop: () => void
}

/**
 * Listens on every currently- and later-connected MIDI input for Note On /
 * Program Change messages ("Generic WebMIDI Input" per docs/05 Phase 4) and
 * calls onTrigger for each one. Returns null when the browser has no Web
 * MIDI support, or the user denies/lacks permission - both are normal,
 * expected states (Graceful Degradation), not errors.
 */
export async function listenForMidiTriggers(onTrigger: () => void): Promise<MidiListenHandle | null> {
  if (!isWebMidiSupported()) return null

  let access: MIDIAccess
  try {
    access = await navigator.requestMIDIAccess()
  } catch {
    return null
  }

  const attached = new Set<MIDIInput>()
  const handler = (event: MIDIMessageEvent) => {
    const data = event.data ? Array.from(event.data) : []
    const command = (data[0] ?? 0) & 0xf0
    const isNoteOn = command === 0x90 && (data[2] ?? 0) > 0
    const isProgramChange = command === 0xc0
    if (isNoteOn || isProgramChange) onTrigger()
  }

  function attach(input: MIDIInput) {
    if (attached.has(input)) return
    input.addEventListener('midimessage', handler)
    attached.add(input)
  }

  access.inputs.forEach(attach)
  const onStateChange = () => access.inputs.forEach(attach)
  access.addEventListener('statechange', onStateChange)

  return {
    inputCount: access.inputs.size,
    stop: () => {
      attached.forEach((input) => input.removeEventListener('midimessage', handler))
      access.removeEventListener('statechange', onStateChange)
    },
  }
}
