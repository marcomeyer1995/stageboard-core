import { useEffect } from 'react'
import { type DetectedHardware, hardwareKeyFor, type HardwareId, matchDetectedHardware, type PluginInstallation } from 'shared-types'
import { getDeviceId } from './deviceId'
import { reportDiscoveryCandidate } from './discoveryClient'
import { getRememberedLogicalDeviceId, rememberLogicalDeviceId } from './hardwareDeviceMemory'
import { listenForMidiConnections } from './webMidi'
import { findMidiOutputIdByNamePattern } from './webMidiOutput'
import { listenForUsbConnections } from './webUsb'
import { useActiveSystemTabStore } from '../store/useActiveSystemTabStore'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useDialogStore } from '../store/useDialogStore'
import { useDiscoverySessionStore } from '../store/useDiscoverySessionStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'

/**
 * Writes this tablet's own DeviceTransportConfig for `detected` bound to `logicalDeviceId` via
 * `match`, remembers the pairing (#106's Auto-Memory), and updates the Logical Device's own live
 * binding (`pluginId`/`executionTarget`, logicalDevice.ts) to point at this device - the
 * counterpart to core-backend's midiWatcher.ts doing the same for a Stage-Server win. Shared by
 * the passive per-tablet flow below and by Discovery Mode's "I just won a role" reaction
 * (resolveDiscoveryWins) - both are just different ways of arriving at the same (detected,
 * match, logicalDeviceId) triple.
 */
async function bindDetectedDevice(detected: DetectedHardware, match: PluginInstallation, logicalDeviceId: string): Promise<void> {
  const deviceId = getDeviceId()
  const transportId = match.transports[0]?.id ?? null
  const values: Record<string, string> = {}
  const hasMidiOutputField = match.transports[0]?.fields.some((field) => field.key === 'midiOutputId') ?? false
  if (detected.kind === 'webmidi' && hasMidiOutputField) {
    // detected.portId is an *input*-port id (this hook only ever observes access.inputs) -
    // useless for actually sending output. Resolve the real MIDIOutput by the matched plugin's
    // own namePattern instead (webMidiOutput.ts's doc comment has the full story); falls back to
    // the input id for a catch-all plugin with no namePattern (generic-webmidi, input-only - it
    // never reads this value, so the fallback is inert but keeps the field populated with
    // *something* for TransportConfigForm's manual-edit case).
    const namePattern = match.hardwareIds.find(
      (id): id is Extract<HardwareId, { kind: 'webmidi' }> => id.kind === 'webmidi' && !!id.namePattern,
    )?.namePattern
    const outputId = namePattern ? await findMidiOutputIdByNamePattern(namePattern) : null
    values.midiOutputId = outputId ?? detected.portId
  }
  await useDeviceTransportConfigStore
    .getState()
    .save({ id: `${deviceId}:${logicalDeviceId}`, deviceId, logicalDeviceId, transportId, values })
  rememberLogicalDeviceId(hardwareKeyFor(detected), logicalDeviceId)

  const logicalDevice = useLogicalDevicesStore.getState().devices.find((device) => device.id === logicalDeviceId)
  if (logicalDevice && (logicalDevice.pluginId !== match.id || logicalDevice.executionTarget !== deviceId)) {
    await useLogicalDevicesStore.getState().save({ ...logicalDevice, pluginId: match.id, executionTarget: deviceId })
  }
}

/** Reconstructs the `DetectedHardware` a Discovery candidate was originally reported from -
 * enough to feed `bindDetectedDevice` (only the fields that actually affect binding: `portId`
 * for the webmidi-output lookup, `name`/`manufacturer` are cosmetic only there). */
function detectedFromCandidateKey(hardwareKey: string, name: string, manufacturer: string): DetectedHardware | null {
  if (hardwareKey.startsWith('webmidi:')) return { kind: 'webmidi', portId: hardwareKey.slice('webmidi:'.length), name, manufacturer }
  if (hardwareKey.startsWith('webusb:')) {
    const [, vendorId, productId] = hardwareKey.split(':')
    return { kind: 'webusb', vendorId: Number(vendorId), productId: Number(productId) }
  }
  return null
}

let handledDiscoveryWins = new Set<string>()

/** Test-only: this module's state is shared across the whole process by design (one set for the
 * tab's lifetime) - tests need a way to reset it between runs, same convention core-backend's
 * in-memory stores already use (e.g. presenceStore.ts's `__resetPresenceStoreForTests`). */
export function __resetHardwareDetectionForTests(): void {
  handledDiscoveryWins = new Set<string>()
}

/**
 * The counterpart to core-backend's midiWatcher.ts `writeWonRoles()` - a tablet has no
 * request/response "did I win" to poll, so this just re-scans the live broadcast snapshot
 * (cheap: a handful of candidates at most) every time it changes, and binds any of *this
 * tablet's* own candidates that just turned `assigned` and hasn't been written yet.
 *
 * Keyed by `hardwareKey:assignedLogicalDeviceId`, not `hardwareKey` alone - the same physical
 * port can legitimately win a *different* role later (e.g. its first role got deleted and
 * DeviceSetupWizard.tsx's manual "Verwenden" reassigns it to a freshly-created one still using
 * the same hardware). Keying on just the port would leave that port permanently unbindable after
 * its first-ever resolution, since the exact same hardwareKey would already be "handled".
 */
async function resolveDiscoveryWins(): Promise<void> {
  const { session } = useDiscoverySessionStore.getState()
  const deviceId = getDeviceId()
  const installed = usePluginsStore.getState().installed

  for (const candidate of session.candidates) {
    if (candidate.reporterId !== deviceId) continue
    if (candidate.status !== 'assigned' || !candidate.assignedLogicalDeviceId) continue
    const winKey = `${candidate.hardwareKey}:${candidate.assignedLogicalDeviceId}`
    if (handledDiscoveryWins.has(winKey)) continue

    const match = candidate.matchedPluginId ? installed.find((p) => p.id === candidate.matchedPluginId) : null
    const detected = detectedFromCandidateKey(candidate.hardwareKey, candidate.name, candidate.manufacturer)
    if (!match || !detected) continue

    handledDiscoveryWins.add(winKey)
    await bindDetectedDevice(detected, match, candidate.assignedLogicalDeviceId)
  }
}

/** Exported for hardwareDetection.test.ts - the actual match/prompt/bind logic, independent of
 * the WebMIDI/WebUSB event wiring below. */
export async function handleDetected(detected: DetectedHardware) {
  const plugins = usePluginsStore.getState()
  const logicalDevices = useLogicalDevicesStore.getState()
  const deviceTransportConfig = useDeviceTransportConfigStore.getState()
  // Stores not loaded for the active workspace yet (or no workspace active at all) - act on
  // nothing rather than risk writing against the wrong/an empty workspace. The hook below
  // replays every device seen while not-yet-loaded once loading finishes, so this isn't a
  // silent drop for the common case of a device that was already connected at app startup.
  if (!plugins.loaded || !logicalDevices.loaded || !deviceTransportConfig.loaded) return

  const discovery = useDiscoverySessionStore.getState()
  if (discovery.session.active) {
    // Discovery Mode is running: defer entirely to the bandwide session instead of this
    // tablet's own passive #106 flow below - reporting is idempotent (the server just updates
    // the existing candidate entry on a repeat report), so replaying an already-reported device
    // here (the hook below does this on every session-active edge) is harmless. Actually binding
    // a winning candidate is resolveDiscoveryWins's job, triggered off the session store itself
    // rather than from here, since a role can resolve long after this specific report.
    void reportDiscoveryCandidate(discovery.workspaceId, getDeviceId(), detected)
    return
  }

  const remembered = getRememberedLogicalDeviceId(hardwareKeyFor(detected))
  if (remembered) {
    // "Silently re-binds" (#106's Auto-Memory) - re-establish the config rather than just doing
    // nothing, so a workspace reset that dropped the DeviceTransportConfig doc still recovers on
    // the next reconnect, without ever showing a dialog again for a device already assigned.
    const match = matchDetectedHardware(plugins.installed.filter((plugin) => plugin.enabled), detected)
    if (match) await bindDetectedDevice(detected, match, remembered)
    return
  }

  const match = matchDetectedHardware(
    plugins.installed.filter((plugin) => plugin.enabled),
    detected,
  )
  if (!match) return // Unrecognized device, or its plugin isn't installed/enabled - ignore silently.

  const candidates = logicalDevices.devices.filter((device) => match.capabilities.includes(device.capability))
  const label = detected.kind === 'webmidi' ? detected.name || detected.manufacturer || match.name : match.name

  // A never-before-seen device with no remembered binding needs a human decision (which role,
  // or "no role fits yet") - the alert/prompt below, both modal popups. Outside System →
  // Hardware, silently drop it instead of interrupting whatever's actually on screen - a live
  // show, most importantly (Marco, explicit request after a "Midi Through Port-0" hot-plug
  // prompt appeared unprompted during testing; confirmed via AskUserQuestion: drop it, don't
  // queue a replay for later). The remembered-device silent-rebind path above this already
  // never shows anything, so it's unaffected - only the "ask a human" paths are gated.
  if (useActiveSystemTabStore.getState().activeTab !== 'hardware') return

  if (candidates.length === 0) {
    await useDialogStore
      .getState()
      .alert(
        `Für "${label}" (${match.name}) ist noch keine passende Rolle vorhanden. Lege unter System → Hardware zuerst ein Logical Device für diese Fähigkeit an.`,
        { title: 'Neues Gerät erkannt' },
      )
    return
  }

  const result = await useDialogStore.getState().promptFields(
    `Neues Gerät: ${label}`,
    [
      {
        key: 'logicalDeviceId',
        label: 'Welche Rolle soll dieses Gerät spielen?',
        type: 'radio',
        defaultValue: '',
        options: candidates.map((device) => ({ value: device.id, label: device.name })),
      },
    ],
    'Rolle zuweisen',
  )
  const logicalDeviceId = result?.logicalDeviceId
  if (!logicalDeviceId) return // Cancelled, or submitted with nothing picked - ask again next connect.

  await bindDetectedDevice(detected, match, logicalDeviceId)
}

function allHardwareStoresLoaded(): boolean {
  return usePluginsStore.getState().loaded && useLogicalDevicesStore.getState().loaded && useDeviceTransportConfigStore.getState().loaded
}

/**
 * "Plug, Prompt, and Play" (#106): listens for newly-connected WebMIDI/WebUSB devices for the
 * lifetime of the app, matches each against installed plugins' catalog metadata
 * (shared-types' hardwareMatching.ts - no plugin code loaded), and on a match either silently
 * re-binds a remembered device or prompts for a Logical Device role (hardwareDeviceMemory.ts's
 * Auto-Memory). Detection itself always runs, everywhere, for the app's whole lifetime - that's
 * required for Discovery Mode's own band-wide auto-discovery to work from any tablet regardless
 * of what that tablet's own screen shows (`handleDetected`'s Discovery-active branch reports
 * into the session unconditionally). Only the ad-hoc "never seen this device before, which role?"
 * popup is gated to System → Hardware being on screen - see `handleDetected`'s own comment at
 * that check for why.
 *
 * A device that's already plugged in when the app launches fires its WebMIDI/WebUSB "connect"
 * event as soon as `requestMIDIAccess()`/`navigator.usb.getDevices()` resolve - typically well
 * before the workspace-scoped stores handleDetected reads (installed plugins, Logical Devices,
 * DeviceTransportConfig) finish their own async CouchDB load. Rather than let handleDetected's
 * loaded-guard silently and permanently drop that device (no further "connect" event will ever
 * fire for it), every device seen is remembered here and replayed once loading catches up -
 * edge-triggered on not-loaded -> loaded so it also re-fires after a workspace switch, which
 * flips every store back through not-loaded. The same replay also fires when Discovery Mode
 * turns on (not-active -> active), so a device already plugged in before the admin started
 * Discovery still gets reported into the session, not just future connects.
 */
export function useHardwareDetection(): void {
  useEffect(() => {
    let cancelled = false
    let wasLoaded = false
    let wasDiscoveryActive = false
    const stops: (() => void)[] = []
    const seen: DetectedHardware[] = []

    function onDetected(detected: DetectedHardware) {
      if (cancelled) return
      seen.push(detected)
      void handleDetected(detected)
    }

    void listenForMidiConnections((port) => {
      onDetected({ kind: 'webmidi', portId: port.id, name: port.name ?? '', manufacturer: port.manufacturer ?? '' })
    }).then((handle) => handle && stops.push(handle.stop))

    void listenForUsbConnections((device) => {
      onDetected({ kind: 'webusb', vendorId: device.vendorId, productId: device.productId })
    }).then((handle) => handle && stops.push(handle.stop))

    function onStoreChange() {
      const loaded = allHardwareStoresLoaded()
      const discoveryActive = useDiscoverySessionStore.getState().session.active
      if ((loaded && !wasLoaded) || (discoveryActive && !wasDiscoveryActive)) {
        seen.forEach((detected) => void handleDetected(detected))
      }
      wasLoaded = loaded
      wasDiscoveryActive = discoveryActive
    }
    const unsubscribes = [usePluginsStore, useLogicalDevicesStore, useDeviceTransportConfigStore, useDiscoverySessionStore].map(
      (store) => store.subscribe(onStoreChange),
    )
    stops.push(...unsubscribes)

    // Runs on every session update (not just the active-edge above) - a role can resolve at any
    // point while Discovery Mode stays active, long after this tablet's own report of it.
    stops.push(useDiscoverySessionStore.subscribe(() => void resolveDiscoveryWins()))

    return () => {
      cancelled = true
      stops.forEach((stop) => stop())
    }
  }, [])
}
