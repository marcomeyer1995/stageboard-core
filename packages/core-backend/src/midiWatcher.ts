import { Input, Output } from '@julusian/midi'
import {
  DeviceTransportConfigSchema,
  LogicalDeviceSchema,
  LEGACY_HOST_TARGET,
  hardwareKeyFor,
  type CcSequence,
  type DetectedHardware,
  type HardwareId,
  type LogicalDevice,
} from 'shared-types'
import { putDoc, putDocWithRetry, type DatabaseConfig } from './database.js'
import { discoverySessions as discoverySessionStore } from 'sync-host'
import { workspaceDbName } from './workspaceProvisioning.js'

/** Same cadence discoverySessionStore.ts's own candidate-settle debounce uses - this is just
 * "keep the port list fresh", not latency-sensitive. */
const POLL_INTERVAL_MS = 2000

const DEVICE_TRANSPORT_CONFIG_PREFIX = 'device-transport-config:'
const LOGICAL_DEVICE_PREFIX = 'logical-devices:'

export interface MidiWatcherOptions {
  database: DatabaseConfig
  workspaceId: string
  /** The id this host goes by (`STAGEBOARD_HOST_ID`, #964): what it reports under and what a role it detects is bound to. Absent: the legacy word. */
  hostId?: string
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
 * Gear plugged directly into the Host (not a tablet) - this workspace's native-MIDI
 * counterpart to stage-pwa's useHardwareDetection.ts, participating in the exact same
 * discoverySessionStore.ts as every tablet: it reports every port it sees, and when Discovery
 * Mode asks a musician to "identify" a role the Host itself is a contender for, it
 * listens for the matching CC sequence on that one native port and reports back, same as a
 * tablet's useDiscoveryTrigger.ts would.
 */
export function createMidiWatcher(options: MidiWatcherOptions): MidiWatcherHandle {
  const { database, workspaceId, log } = options
  const hostTarget = options.hostId ?? LEGACY_HOST_TARGET
  let stopped = false
  let triggerListener: { input: Input; hardwareKey: string } | null = null
  const written = new Set<string>() // hardwareKeys already written, so a role only gets written once
  let unavailable = false

  /** Creates a native RtMidi port, or null when the ALSA sequencer can't be opened (e.g.
   * `/dev/snd/seq` not accessible at boot before a desktop login, #336). MIDI is optional - the
   * Host must keep running without it, and the poll keeps retrying, so ports appear as
   * soon as access exists. Logged once per outage, not every poll. */
  function openNative<T>(make: () => T): T | null {
    try {
      const port = make()
      if (unavailable) {
        unavailable = false
        log.info('Native MIDI available again')
      }
      return port
    } catch (err) {
      if (!unavailable) {
        unavailable = true
        log.error('Native MIDI unavailable - running without the Host\'s own MIDI ports, retrying', { error: String(err) })
      }
      return null
    }
  }

  /**
   * Resolves the real *output* port to actually send to and writes the DeviceTransportConfig
   * doc, for any of the Host's own candidates that just won a role and hasn't been
   * written yet - the counterpart to a tablet reacting to seeing itself win (#106's `bind()`).
   * Deliberately resolves by the matched plugin's `hardwareIds` namePattern against `Output`
   * ports, not by reusing the winning candidate's own hardwareKey: that key was built from an
   * `Input` port (what the Host can *receive* on), a different physical/virtual port
   * from the `Output` it needs to *send* on - webMidiOutput.ts's doc comment has the full story
   * on why those two are never the same id, client-side or here.
   */
  function writeWonRoles(): void {
    const session = discoverySessionStore.getSnapshot(workspaceId)
    for (const candidate of session.candidates) {
      if (candidate.reporterId !== hostTarget) continue
      if (candidate.status !== 'assigned' || !candidate.assignedLogicalDeviceId) continue
      if (written.has(candidate.hardwareKey)) continue

      const plugin = candidate.matchedPluginId ? discoverySessionStore.getPlugin(workspaceId, candidate.matchedPluginId) : null
      const namePattern = plugin?.hardwareIds.find(
        (id): id is Extract<HardwareId, { kind: 'webmidi' }> => id.kind === 'webmidi' && !!id.namePattern,
      )?.namePattern
      if (!namePattern) continue

      const output = openNative(() => new Output())
      if (!output) return
      try {
        const count = output.getPortCount()
        let outputIndex = -1
        for (let i = 0; i < count; i++) {
          if (output.getPortName(i).toLowerCase().includes(namePattern.toLowerCase())) outputIndex = i
        }
        if (outputIndex === -1) continue // No matching output yet - try again next poll.

        const logicalDeviceId = candidate.assignedLogicalDeviceId
        const doc = DeviceTransportConfigSchema.parse({
          id: `${hostTarget}:${logicalDeviceId}`,
          deviceId: hostTarget,
          logicalDeviceId,
          transportId: null,
          values: { midiOutputId: output.getPortName(outputIndex) },
        })
        void putDoc(database, workspaceDbName(workspaceId), { ...doc, _id: `${DEVICE_TRANSPORT_CONFIG_PREFIX}${doc.id}` }).catch((err) =>
          log.error('Failed to write DeviceTransportConfig for a Host-plugged device', { error: String(err) }),
        )

        // The Logical Device's own live binding (logicalDevice.ts) - the counterpart to a
        // tablet's bindDetectedDevice() also updating this, now that #10's per-Setup binding
        // moved directly onto the device itself. putDocWithRetry (not plain putDoc) since this
        // doc's other fields (name, capability) must survive the merge, unlike the
        // DeviceTransportConfig write above which this watcher fully owns. LogicalDeviceSchema
        // has no _id/_rev fields, so those are re-attached after parsing rather than passed
        // through it (a bare zod object schema silently strips unknown keys).
        const logicalDeviceDocId = `${LOGICAL_DEVICE_PREFIX}${logicalDeviceId}`
        void putDocWithRetry<LogicalDevice & { _id: string; _rev?: string }>(
          database,
          workspaceDbName(workspaceId),
          logicalDeviceDocId,
          (existing) => {
            const merged = LogicalDeviceSchema.parse({
              id: logicalDeviceId,
              name: existing?.name,
              capability: existing?.capability,
              pluginId: plugin.id,
              executionTarget: hostTarget,
            })
            return { ...merged, _id: logicalDeviceDocId, _rev: existing?._rev }
          },
        ).catch((err) => log.error('Failed to write Logical Device binding for a Host-plugged device', { error: String(err) }))

        written.add(candidate.hardwareKey)
      } finally {
        output.destroy()
      }
    }
  }

  function reportCurrentPorts(): void {
    const probe = openNative(() => new Input())
    if (!probe) return
    try {
      const count = probe.getPortCount()
      for (let i = 0; i < count; i++) {
        discoverySessionStore.reportCandidate(workspaceId, hostTarget, detectedFor(probe.getPortName(i)))
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
          (c) => c.reporterId === hostTarget && c.status === 'identifying' && c.matchedPluginId === identifying.pluginId,
        )
      : null

    if (!ownCandidate || !identifying) {
      stopTriggerListener()
      return
    }
    if (triggerListener?.hardwareKey === ownCandidate.hardwareKey) return // already listening on the right port

    stopTriggerListener()

    const probe = openNative(() => new Input())
    if (!probe) return
    try {
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
        discoverySessionStore.reportTriggered(workspaceId, hostTarget, ownCandidate.hardwareKey)
      })
      probe.on('message', (_deltaTime: number, message: number[]) => handleMessage(message))
      probe.openPort(index)
      triggerListener = { input: probe, hardwareKey: ownCandidate.hardwareKey }
    } catch (err) {
      // The port vanished between listing and opening - the next poll tries again.
      log.error('Failed to open native MIDI port for identification', { error: String(err) })
      probe.destroy()
    }
  }

  reportCurrentPorts()
  const pollHandle = setInterval(() => {
    reportCurrentPorts()
    syncTriggerListener()
    writeWonRoles()
  }, POLL_INTERVAL_MS)
  // Reacts immediately to a role entering "identifying" (or the Host itself winning
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
