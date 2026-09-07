import { useEffect } from 'react'
import { hardwareKeyFor } from 'shared-types'
import { getDeviceId } from './deviceId'
import { reportDiscoveryTriggered } from './discoveryClient'
import { isWebMidiSupported } from './webMidi'
import { useDiscoverySessionStore } from '../store/useDiscoverySessionStore'

interface Listening {
  input: MIDIInput
  hardwareKey: string
  stop: () => void
}

/** Matches an incoming CC one step at a time - resets to "matches step 0" rather than back to
 * nothing on a mismatch, mirroring core-backend's midiWatcher.ts makeSequenceMatcher (kept as a
 * small duplicate rather than a shared package: this one reads a WebMIDI `Uint8Array`, the
 * server's reads a plain `number[]` from a different native library entirely). */
function makeSequenceMatcher(sequence: { cc: number; value: number }[], onComplete: () => void): (data: Uint8Array) => void {
  let progress = 0
  return (data) => {
    const status = data[0] ?? 0
    if ((status & 0xf0) !== 0xb0) return // not a Control Change
    const cc = data[1]
    const value = data[2]
    const expected = sequence[progress]
    if (cc === expected.cc && value === expected.value) {
      progress += 1
      if (progress === sequence.length) {
        progress = 0
        onComplete()
      }
    } else {
      progress = cc === sequence[0].cc && value === sequence[0].value ? 1 : 0
    }
  }
}

/**
 * Discovery Mode's per-tablet half of the trigger-based disambiguation flow
 * (discoverySessionStore.ts on the server owns the queue; core-backend's midiWatcher.ts is the
 * native-MIDI counterpart to this hook). While the session's `identifying` targets a role one of
 * *this tablet's* own reported candidates is a contender for, listens for that plugin's declared
 * `matchCcSequence` on that one specific port and reports back on a match - the UI-visible
 * instruction itself is rendered by DiscoveryBanner.tsx, reactively off the same store, not by
 * this hook (a physical MIDI listener has no business owning dialog/banner state).
 */
export function useDiscoveryTrigger(): void {
  useEffect(() => {
    let cancelled = false
    let listening: Listening | null = null

    function stopListening(): void {
      listening?.stop()
      listening = null
    }

    async function sync(): Promise<void> {
      if (cancelled) return
      const { workspaceId, session } = useDiscoverySessionStore.getState()
      const identifying = session.identifying
      const deviceId = getDeviceId()
      const ownCandidate = identifying
        ? session.candidates.find(
            (c) => c.reporterId === deviceId && c.status === 'identifying' && c.matchedPluginId === identifying.pluginId,
          )
        : null

      if (!ownCandidate || !identifying) {
        stopListening()
        return
      }
      if (listening?.hardwareKey === ownCandidate.hardwareKey) return // already listening on the right port

      stopListening()
      if (!isWebMidiSupported()) return

      let access: MIDIAccess
      try {
        access = await navigator.requestMIDIAccess()
      } catch {
        return
      }
      if (cancelled) return

      const target = Array.from(access.inputs.values()).find(
        (input) =>
          hardwareKeyFor({ kind: 'webmidi', portId: input.id, name: input.name ?? '', manufacturer: input.manufacturer ?? '' }) ===
          ownCandidate.hardwareKey,
      )
      if (!target) return

      const matchesSequence = makeSequenceMatcher(identifying.matchCcSequence, () => {
        void reportDiscoveryTriggered(workspaceId, deviceId, ownCandidate.hardwareKey)
      })
      const handler = (event: MIDIMessageEvent) => {
        if (event.data) matchesSequence(event.data)
      }
      target.addEventListener('midimessage', handler)
      listening = { input: target, hardwareKey: ownCandidate.hardwareKey, stop: () => target?.removeEventListener('midimessage', handler) }
    }

    void sync()
    const unsubscribe = useDiscoverySessionStore.subscribe(() => void sync())

    return () => {
      cancelled = true
      unsubscribe()
      stopListening()
    }
  }, [])
}
