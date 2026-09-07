import { z } from 'zod'
import type { HardwareId } from './hardwareId.js'
import type { PluginInstallation } from './pluginInstallation.js'

/** A device just seen via a WebMIDI/WebUSB connect event (#106) - see stage-pwa's webMidi.ts/
 * webUsb.ts for where these fields come from, and core-backend's midiWatcher.ts (Discovery Mode)
 * for the native-MIDI equivalent. `portId` is WebMIDI's browser-assigned `MIDIPort.id` (or the
 * native port id server-side), stable enough across reconnects on the same physical port to key
 * Auto-Memory off (hardwareKeyFor). A real Zod schema (not just a plain type) because Discovery
 * Mode's `POST /discovery/candidates` carries one of these over the wire and needs real
 * validation at that boundary - stage-pwa's own detection code still just constructs the plain
 * value directly from WebMIDI/WebUSB API data, no parsing needed there. */
export const DetectedHardwareSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('webmidi'), portId: z.string().min(1), name: z.string(), manufacturer: z.string() }),
  z.object({ kind: z.literal('webusb'), vendorId: z.number().int().nonnegative(), productId: z.number().int().nonnegative() }),
])
export type DetectedHardware = z.infer<typeof DetectedHardwareSchema>

function matchesHardwareId(id: HardwareId, detected: DetectedHardware): boolean {
  if (id.kind === 'webmidi') {
    if (detected.kind !== 'webmidi') return false
    if (!id.namePattern) return true
    const needle = id.namePattern.toLowerCase()
    return detected.name.toLowerCase().includes(needle) || detected.manufacturer.toLowerCase().includes(needle)
  }
  if (detected.kind !== 'webusb') return false
  if (id.vendorId !== detected.vendorId) return false
  return id.productId === undefined || id.productId === detected.productId
}

/**
 * Which installed plugin's catalog metadata (PluginInstallation.hardwareIds) matches a
 * just-detected device, if any - the coarse, code-free match #106 needs before deciding whether
 * to prompt for a role. A plugin with a specific `namePattern` wins over a generic catch-all
 * (no `namePattern`) that also matches, so once a device-specific plugin (e.g. Kemper Profiler)
 * is installed alongside `generic-webmidi`, its own device resolves to it, not the catch-all -
 * see stage-pwa's PluginManager.tsx CATALOG.
 */
export function matchDetectedHardware(catalog: PluginInstallation[], detected: DetectedHardware): PluginInstallation | null {
  let genericMatch: PluginInstallation | null = null
  for (const plugin of catalog) {
    for (const id of plugin.hardwareIds) {
      if (!matchesHardwareId(id, detected)) continue
      const isGeneric = id.kind === 'webmidi' && !id.namePattern
      if (!isGeneric) return plugin
      genericMatch ??= plugin
    }
  }
  return genericMatch
}

/** A stable identity key for a physical device, for Auto-Memory (stage-pwa's
 * hardwareDeviceMemory.ts). */
export function hardwareKeyFor(detected: DetectedHardware): string {
  return detected.kind === 'webmidi' ? `webmidi:${detected.portId}` : `webusb:${detected.vendorId}:${detected.productId}`
}
