import { describe, expect, it } from 'vitest'
import type { PluginInstallation } from './pluginInstallation.js'
import { type DetectedHardware, hardwareKeyFor, matchDetectedHardware } from './hardwareMatching.js'

function plugin(overrides: Partial<PluginInstallation>): PluginInstallation {
  return {
    id: 'plugin-1',
    name: 'Plugin',
    version: '0.0.1',
    runtime: 'client',
    capabilities: [],
    transports: [],
    hardwareIds: [],
    enabled: true,
    installedAt: 0,
    ...overrides,
  }
}

const GENERIC_MIDI = plugin({ id: 'generic-webmidi', name: 'Generic WebMIDI Input', hardwareIds: [{ kind: 'webmidi' }] })

// Modeled on the real port name Marco's Kemper Profiler emulator opens
// (~/Device Emulators/Kemper Emulator, `kemper-emulator run`).
const KEMPER_PLUGIN = plugin({
  id: 'kemper',
  name: 'Kemper Profiler',
  hardwareIds: [{ kind: 'webmidi', namePattern: 'Kemper' }],
})

function midiDevice(name: string, manufacturer = ''): DetectedHardware {
  return { kind: 'webmidi', portId: 'port-1', name, manufacturer }
}

describe('matchDetectedHardware', () => {
  it('matches a generic (no namePattern) webmidi entry against any device', () => {
    expect(matchDetectedHardware([GENERIC_MIDI], midiDevice('Kemper Profiler Emulator'))).toBe(GENERIC_MIDI)
    expect(matchDetectedHardware([GENERIC_MIDI], midiDevice('Some Random Controller'))).toBe(GENERIC_MIDI)
  })

  it('matches a namePattern case-insensitively against name or manufacturer', () => {
    expect(matchDetectedHardware([KEMPER_PLUGIN], midiDevice('Kemper Profiler Emulator'))).toBe(KEMPER_PLUGIN)
    expect(matchDetectedHardware([KEMPER_PLUGIN], midiDevice('KEMPER PROFILER'))).toBe(KEMPER_PLUGIN)
    expect(matchDetectedHardware([KEMPER_PLUGIN], midiDevice('Rig Manager', 'Kemper'))).toBe(KEMPER_PLUGIN)
  })

  it('does not match a namePattern entry against an unrelated device', () => {
    expect(matchDetectedHardware([KEMPER_PLUGIN], midiDevice('RC-500'))).toBeNull()
  })

  it('prefers a specific match over a generic catch-all for the same device', () => {
    expect(matchDetectedHardware([GENERIC_MIDI, KEMPER_PLUGIN], midiDevice('Kemper Profiler Emulator'))).toBe(KEMPER_PLUGIN)
    expect(matchDetectedHardware([KEMPER_PLUGIN, GENERIC_MIDI], midiDevice('Kemper Profiler Emulator'))).toBe(KEMPER_PLUGIN)
  })

  it('falls back to the generic catch-all when no specific plugin matches', () => {
    expect(matchDetectedHardware([GENERIC_MIDI, KEMPER_PLUGIN], midiDevice('RC-500'))).toBe(GENERIC_MIDI)
  })

  it('returns null when nothing in the catalog matches', () => {
    expect(matchDetectedHardware([KEMPER_PLUGIN], midiDevice('RC-500'))).toBeNull()
  })

  it('matches webusb by vendorId, with an optional productId', () => {
    const anyKemperUsb = plugin({ hardwareIds: [{ kind: 'webusb', vendorId: 0x1234 }] })
    const exactModel = plugin({ hardwareIds: [{ kind: 'webusb', vendorId: 0x1234, productId: 0x5678 }] })
    const device: DetectedHardware = { kind: 'webusb', vendorId: 0x1234, productId: 0x5678 }
    const otherProduct: DetectedHardware = { kind: 'webusb', vendorId: 0x1234, productId: 0x9999 }

    expect(matchDetectedHardware([anyKemperUsb], device)).toBe(anyKemperUsb)
    expect(matchDetectedHardware([exactModel], device)).toBe(exactModel)
    expect(matchDetectedHardware([exactModel], otherProduct)).toBeNull()
    expect(matchDetectedHardware([anyKemperUsb], otherProduct)).toBe(anyKemperUsb)
  })

  it('never matches a webmidi entry against a webusb device or vice versa', () => {
    const usbDevice: DetectedHardware = { kind: 'webusb', vendorId: 1, productId: 2 }
    expect(matchDetectedHardware([GENERIC_MIDI], usbDevice)).toBeNull()
    const usbPlugin = plugin({ hardwareIds: [{ kind: 'webusb', vendorId: 1 }] })
    expect(matchDetectedHardware([usbPlugin], midiDevice('Kemper'))).toBeNull()
  })
})

describe('hardwareKeyFor', () => {
  it('keys webmidi devices by port id', () => {
    expect(hardwareKeyFor(midiDevice('Kemper'))).toBe('webmidi:port-1')
  })

  it('keys webusb devices by vendor+product id', () => {
    expect(hardwareKeyFor({ kind: 'webusb', vendorId: 0x1234, productId: 0x5678 })).toBe('webusb:4660:22136')
  })
})
