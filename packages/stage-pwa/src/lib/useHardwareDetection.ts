import { useEffect } from 'react'
import { type DetectedHardware, hardwareKeyFor, type HardwareId, matchDetectedHardware, type PluginInstallation } from 'shared-types'
import { getDeviceId } from './deviceId'
import { getRememberedLogicalDeviceId, rememberLogicalDeviceId } from './hardwareDeviceMemory'
import { listenForMidiConnections } from './webMidi'
import { findMidiOutputIdByNamePattern } from './webMidiOutput'
import { listenForUsbConnections } from './webUsb'
import { useDeviceTransportConfigStore } from '../store/useDeviceTransportConfigStore'
import { useDialogStore } from '../store/useDialogStore'
import { useLogicalDevicesStore } from '../store/useLogicalDevicesStore'
import { usePluginsStore } from '../store/usePluginsStore'

/**
 * Writes this tablet's own DeviceTransportConfig for `detected` bound to `logicalDeviceId` via
 * `match`, and remembers the pairing (#106's Auto-Memory).
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
 * Auto-Memory).
 *
 * A device that's already plugged in when the app launches fires its WebMIDI/WebUSB "connect"
 * event as soon as `requestMIDIAccess()`/`navigator.usb.getDevices()` resolve - typically well
 * before the workspace-scoped stores handleDetected reads (installed plugins, Logical Devices,
 * DeviceTransportConfig) finish their own async CouchDB load. Rather than let handleDetected's
 * loaded-guard silently and permanently drop that device (no further "connect" event will ever
 * fire for it), every device seen is remembered here and replayed once loading catches up -
 * edge-triggered on not-loaded -> loaded so it also re-fires after a workspace switch, which
 * flips every store back through not-loaded.
 */
export function useHardwareDetection(): void {
  useEffect(() => {
    let cancelled = false
    let wasLoaded = false
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
      if (loaded && !wasLoaded) {
        seen.forEach((detected) => void handleDetected(detected))
      }
      wasLoaded = loaded
    }
    const unsubscribes = [usePluginsStore, useLogicalDevicesStore, useDeviceTransportConfigStore].map(
      (store) => store.subscribe(onStoreChange),
    )
    stops.push(...unsubscribes)

    return () => {
      cancelled = true
      stops.forEach((stop) => stop())
    }
  }, [])
}
