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
import { createNativeMidi, type NativeMidi } from './nativeMidi.js'

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
  /** This machine's MIDI ports (`nativeMidi.ts`, the module the add-ons send through); default: its own handle, so an outage is logged as the watcher's. */
  midi?: NativeMidi
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
  let triggerListener: { stop: () => void; hardwareKey: string } | null = null
  const written = new Set<string>() // hardwareKeys already written, so a role only gets written once
  // MIDI is optional - the Host must keep running without it (no ALSA sequencer before a desktop login, #336); the module says so once per
  // outage, and the poll keeps retrying, so ports appear as soon as access exists.
  const midi = options.midi ?? createNativeMidi(log)

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

      const outputs = midi.outputs()
      if (!outputs) return
      {
        const outputName = [...outputs].reverse().find((name) => name.toLowerCase().includes(namePattern.toLowerCase()))
        if (outputName === undefined) continue // No matching output yet - try again next poll.

        const logicalDeviceId = candidate.assignedLogicalDeviceId
        const doc = DeviceTransportConfigSchema.parse({
          id: `${hostTarget}:${logicalDeviceId}`,
          deviceId: hostTarget,
          logicalDeviceId,
          transportId: null,
          values: { midiOutputId: outputName },
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
      }
    }
  }

  function reportCurrentPorts(): void {
    for (const name of midi.inputs() ?? []) discoverySessionStore.reportCandidate(workspaceId, hostTarget, detectedFor(name))
  }

  function stopTriggerListener(): void {
    if (!triggerListener) return
    triggerListener.stop()
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

    const port = [...(midi.inputs() ?? [])].reverse().find((name) => hardwareKeyFor(detectedFor(name)) === ownCandidate.hardwareKey)
    if (port === undefined) return
    const handleMessage = makeSequenceMatcher(identifying.matchCcSequence, () => {
      discoverySessionStore.reportTriggered(workspaceId, hostTarget, ownCandidate.hardwareKey)
    })
    // null: the port vanished between listing and opening - the next poll tries again.
    const stop = midi.listen(port, handleMessage)
    if (stop) triggerListener = { stop, hardwareKey: ownCandidate.hardwareKey }
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
