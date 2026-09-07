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

interface MidiConnectionListenHandle {
  stop: () => void
}

/**
 * Reports every currently-connected MIDI input at call time, then every later one that becomes
 * `state === 'connected'` (#106's hardware detection) - a separate `requestMIDIAccess()` call
 * from listenForMidiTriggers above on purpose: this one cares about device *identity*
 * (port.name/manufacturer/id), not `midimessage` traffic, and firing once per newly-connected
 * port (not once per already-attached one on every statechange) is exactly the opposite of what
 * listenForMidiTriggers needs.
 */
export async function listenForMidiConnections(onConnect: (port: MIDIInput) => void): Promise<MidiConnectionListenHandle | null> {
  if (!isWebMidiSupported()) return null

  let access: MIDIAccess
  try {
    access = await navigator.requestMIDIAccess()
  } catch {
    return null
  }

  access.inputs.forEach(onConnect)
  const onStateChange = (event: Event) => {
    const port = (event as MIDIConnectionEvent).port
    if (port?.type === 'input' && port.state === 'connected') onConnect(port as MIDIInput)
  }
  access.addEventListener('statechange', onStateChange)

  return {
    stop: () => access.removeEventListener('statechange', onStateChange),
  }
}
