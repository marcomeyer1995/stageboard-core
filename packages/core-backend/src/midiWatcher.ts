import { Input, Output } from '@julusian/midi'
import {
  DeviceTransportConfigSchema,
  SERVER_EXECUTION_TARGET,
  hardwareKeyFor,
  type CcSequence,
  type DetectedHardware,
  type HardwareId,
} from 'shared-types'
import { putDoc, type CouchConfig } from './couch.js'
import * as discoverySessionStore from './discoverySessionStore.js'
import { workspaceDbName } from './workspaceProvisioning.js'

/** Same cadence discoverySessionStore.ts's own candidate-settle debounce uses - this is just
 * "keep the port list fresh", not latency-sensitive. */
const POLL_INTERVAL_MS = 2000

const DEVICE_TRANSPORT_CONFIG_PREFIX = 'device-transport-config:'

export interface MidiWatcherOptions {
  couch: CouchConfig
  workspaceId: string
  log: { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }
}

export interface MidiWatcherHandle {
  stop: () => void
}

function detectedFor(portName: string): DetectedHardware {
  // RtMidi/ALSA exposes no persistent numeric port id server-side (unlike a browser's WebMIDI
  // MIDIPort.id) - the port name is the best available stable-ish identity, same tradeoff
  // hardwareMatching.ts's doc comment already accepts for the WebMIDI side.
  return { kind: 'webmidi', portId: portName, name: portName, manufacturer: '' }
}

/**
 * Gear plugged directly into the Stage-Server (not a tablet) - this workspace's native-MIDI
 * counterpart to stage-pwa's useHardwareDetection.ts, participating in the exact same
 * discoverySessionStore.ts as every tablet: it reports every port it sees, and when Discovery
 * Mode asks a musician to "identify" a role the Stage-Server itself is a contender for, it
 * listens for the matching CC sequence on that one native port and reports back, same as a
 * tablet's useDiscoveryTrigger.ts would.
 */
export function createMidiWatcher(options: MidiWatcherOptions): MidiWatcherHandle {
  const { couch, workspaceId, log } = options
  let stopped = false
  let triggerListener: { input: Input; hardwareKey: string } | null = null
  const written = new Set<string>() // hardwareKeys already written, so a role only gets written once

  /**
   * Resolves the real *output* port to actually send to and writes the DeviceTransportConfig
   * doc, for any of the Stage-Server's own candidates that just won a role and hasn't been
   * written yet - the counterpart to a tablet reacting to seeing itself win (#106's `bind()`).
   * Deliberately resolves by the matched plugin's `hardwareIds` namePattern against `Output`
   * ports, not by reusing the winning candidate's own hardwareKey: that key was built from an
   * `Input` port (what the Stage-Server can *receive* on), a different physical/virtual port
   * from the `Output` it needs to *send* on - webMidiOutput.ts's doc comment has the full story
   * on why those two are never the same id, client-side or here.
   */
  function writeWonRoles(): void {
    const session = discoverySessionStore.getSnapshot(workspaceId)
    for (const candidate of session.candidates) {
      if (candidate.reporterId !== SERVER_EXECUTION_TARGET) continue
      if (candidate.status !== 'assigned' || !candidate.assignedLogicalDeviceId) continue
      if (written.has(candidate.hardwareKey)) continue

      const plugin = candidate.matchedPluginId ? discoverySessionStore.getPlugin(workspaceId, candidate.matchedPluginId) : null
      const namePattern = plugin?.hardwareIds.find(
        (id): id is Extract<HardwareId, { kind: 'webmidi' }> => id.kind === 'webmidi' && !!id.namePattern,
      )?.namePattern
      if (!namePattern) continue

      const output = new Output()
      try {
        const count = output.getPortCount()
        let outputIndex = -1
        for (let i = 0; i < count; i++) {
          if (output.getPortName(i).toLowerCase().includes(namePattern.toLowerCase())) outputIndex = i
        }
        if (outputIndex === -1) continue // No matching output yet - try again next poll.

        const logicalDeviceId = candidate.assignedLogicalDeviceId
        const doc = DeviceTransportConfigSchema.parse({
          id: `${SERVER_EXECUTION_TARGET}:${logicalDeviceId}`,
          deviceId: SERVER_EXECUTION_TARGET,
          logicalDeviceId,
          transportId: null,
          values: { midiOutputId: output.getPortName(outputIndex) },
        })
        void putDoc(couch, workspaceDbName(workspaceId), { ...doc, _id: `${DEVICE_TRANSPORT_CONFIG_PREFIX}${doc.id}` }).catch((err) =>
          log.error('Failed to write DeviceTransportConfig for a Stage-Server-plugged device', { error: String(err) }),
        )
        written.add(candidate.hardwareKey)
      } finally {
        output.destroy()
      }
    }
  }

  function reportCurrentPorts(): void {
    const probe = new Input()
    try {
      const count = probe.getPortCount()
      for (let i = 0; i < count; i++) {
        discoverySessionStore.reportCandidate(workspaceId, SERVER_EXECUTION_TARGET, detectedFor(probe.getPortName(i)))
      }
    } catch (err) {
      log.error('Failed to enumerate native MIDI ports', { error: String(err) })
    } finally {
      probe.destroy()
    }
  }

  function stopTriggerListener(): void {
    if (!triggerListener) return
    triggerListener.input.closePort()
    triggerListener.input.destroy()
    triggerListener = null
  }

  /** Matches an incoming CC one step at a time against `sequence` - resets to "matches step 0"
   * rather than back to nothing on a mismatch, so a stray step-0 CC in the middle of an
   * otherwise-correct sequence doesn't need the whole thing repeated. */
  function makeSequenceMatcher(sequence: CcSequence, onComplete: () => void): (message: number[]) => void {
    let progress = 0
    return (message) => {
      const [status, cc, value] = message
      if (((status ?? 0) & 0xf0) !== 0xb0) return // not a Control Change
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

  function syncTriggerListener(): void {
    if (stopped) return
    const session = discoverySessionStore.getSnapshot(workspaceId)
    const identifying = session.identifying
    const ownCandidate = identifying
      ? session.candidates.find(
          (c) => c.reporterId === SERVER_EXECUTION_TARGET && c.status === 'identifying' && c.matchedPluginId === identifying.pluginId,
        )
      : null

    if (!ownCandidate || !identifying) {
      stopTriggerListener()
      return
    }
    if (triggerListener?.hardwareKey === ownCandidate.hardwareKey) return // already listening on the right port

    stopTriggerListener()

    const probe = new Input()
    const count = probe.getPortCount()
    let index = -1
    for (let i = 0; i < count; i++) {
      if (hardwareKeyFor(detectedFor(probe.getPortName(i))) === ownCandidate.hardwareKey) index = i
    }
    if (index === -1) {
      probe.destroy()
      return
    }

    const handleMessage = makeSequenceMatcher(identifying.matchCcSequence, () => {
      discoverySessionStore.reportTriggered(workspaceId, SERVER_EXECUTION_TARGET, ownCandidate.hardwareKey)
    })
    probe.on('message', (_deltaTime: number, message: number[]) => handleMessage(message))
    probe.openPort(index)
    triggerListener = { input: probe, hardwareKey: ownCandidate.hardwareKey }
  }

  reportCurrentPorts()
  const pollHandle = setInterval(() => {
    reportCurrentPorts()
    syncTriggerListener()
    writeWonRoles()
  }, POLL_INTERVAL_MS)
  // Reacts immediately to a role entering "identifying" (or the Stage-Server itself winning
  // one) rather than waiting for the next poll.
  const unsubscribe = discoverySessionStore.subscribe(workspaceId, () => {
    syncTriggerListener()
    writeWonRoles()
  })

  return {
    stop: () => {
      stopped = true
      clearInterval(pollHandle)
      unsubscribe()
      stopTriggerListener()
    },
  }
}
