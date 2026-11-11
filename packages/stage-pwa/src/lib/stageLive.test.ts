import { describe, expect, it } from 'vitest'
import { BUILTIN_MODELS, defaultStageMap, equipmentFrom, signalFlows, type DeviceInfoEntry, type LatencyProfileDoc, type VirtualPort } from 'shared-types'
import { stageLive, type StageLiveInput } from './stageLive'

const NOW = 1_000_000
const entry = (extra: Partial<DeviceInfoEntry> = {}): DeviceInfoEntry => ({ ip: '10.0.0.2', os: 'Android', environment: 'native', syncStatus: 'idle', lastSeenAt: NOW - 5_000, networkReachable: true, hostname: null, ...extra })
const KEMPER_PORT: VirtualPort = { id: 'ld-kemper', name: 'Kemper', signalClass: 'midi', input: false }
const KLICK_PORT: VirtualPort = { id: 'klick', name: 'Klick', signalClass: 'sound', input: false }

/** Redmi drives a Kemper over USB (MIDI port "Kemper Player") and plays the click to the mixer; Fire only stands there. */
function stage(overrides: Partial<StageLiveInput> = {}): StageLiveInput {
  const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }, { id: 'fire', name: 'Fire' }])
  const setup = map.setups[0]!
  const add = (modelId: string, id: string, name: string) => {
    map.equipment.push(equipmentFrom(BUILTIN_MODELS.find((m) => m.id === modelId)!, id, name))
    setup.positions[id] = { x: 0, y: 0 }
  }
  add('mixer', 'pult', 'Pult')
  add('amp-modeller', 'kemper', 'Kemper')
  setup.links.push({ id: 'usb', from: { equipmentId: 'device:redmi', portId: 'usb' }, to: { equipmentId: 'kemper', portId: 'usb' }, signals: ['midi'], midiName: 'Kemper Player' })
  setup.links.push({ id: 'jack', from: { equipmentId: 'device:redmi', portId: 'headphones' }, to: { equipmentId: 'pult', portId: 'in', channel: 1 }, signals: ['audio'] })
  setup.routing['device:redmi'] = [
    { from: { kind: 'virtual', virtualPortId: 'ld-kemper' }, to: { kind: 'port', portId: 'usb' } },
    { from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones' } },
  ]
  const equipment = map.equipment.filter((e) => setup.positions[e.id])
  return {
    equipment,
    setup,
    flows: signalFlows(map, setup.id, [KLICK_PORT, KEMPER_PORT]),
    outputs: [{ id: 'ld-kemper', name: 'Kemper', pluginId: 'kemper-plugin' }],
    builtInIds: ['klick', 'track', 'ansagen'],
    deviceInfo: { devices: { redmi: entry({ midiOutputs: ['Kemper Player'], battery: { pct: 80, charging: false } }), fire: entry() } },
    now: NOW,
    serverReachable: true,
    health: { plugins: { 'kemper-plugin': { status: 'online', lastSeenAt: NOW - 1_000 } } },
    ownDeviceId: 'fire',
    ownMidiOutputs: null,
    ownSilenced: [],
    front: {},
    profiles: [],
    ...overrides,
  }
}

const keys = (notes: { key: string }[]) => notes.map((n) => n.key)

describe('stageLive (#747, docs/31 §9)', () => {
  it('everything there: devices online with battery, the MIDI port found, the driver running', () => {
    const input = stage()
    // The fixture must really carry both signals over their cables.
    expect(input.flows.some((f) => f.hops.some((h) => h.linkId === 'usb'))).toBe(true)
    const live = stageLive(input)
    expect(live.equipment['device:redmi']).toMatchObject({ status: 'ok' })
    expect(keys(live.equipment['device:redmi']!.notes)).toEqual(['online', 'battery'])
    expect(live.links.usb).toMatchObject({ status: 'ok', notes: [{ key: 'midiFound', name: 'Kemper Player' }] })
    expect(live.equipment.kemper).toMatchObject({ status: 'ok', notes: [{ key: 'driverOnline', name: 'Kemper' }] })
    // Nothing to tell about a mixer nobody drives.
    expect(live.equipment.pult).toEqual({ status: 'off', notes: [] })
  })

  it('the Kemper\'s USB cable pulled: the line and the Kemper turn red (acceptance)', () => {
    const live = stageLive(stage({ deviceInfo: { devices: { redmi: entry({ midiOutputs: [] }), fire: entry() } } }))
    expect(live.links.usb).toMatchObject({ status: 'error', notes: [{ key: 'midiMissing' }] })
    expect(live.equipment.kemper!.status).toBe('error')
    expect(keys(live.equipment.kemper!.notes)).toContain('midiMissing')
    // The tablet itself is fine.
    expect(live.equipment['device:redmi']!.status).toBe('ok')
  })

  it('this device knows its own MIDI ports at once, ahead of its report', () => {
    const live = stageLive(stage({ ownDeviceId: 'redmi', ownMidiOutputs: [] }))
    expect(live.links.usb!.status).toBe('error')
  })

  it('a tablet in flight mode appears offline once its report is stale (acceptance); app closed but on the network says so', () => {
    const stale = entry({ lastSeenAt: NOW - 31_000, networkReachable: false, midiOutputs: ['Kemper Player'] })
    const live = stageLive(stage({ deviceInfo: { devices: { redmi: stale, fire: entry({ lastSeenAt: NOW - 60_000, networkReachable: true }) } } }))
    expect(live.equipment['device:redmi']).toMatchObject({ status: 'error', notes: [{ key: 'offline' }] })
    expect(live.equipment['device:fire']).toMatchObject({ status: 'error', notes: [{ key: 'appClosed' }] })
    // What an offline device sees is not known - not a fault of the cable.
    expect(live.links.usb).toMatchObject({ status: 'off', notes: [{ key: 'midiUnknown' }] })
  })

  it('an older app that reports no MIDI ports: not known, not red', () => {
    const live = stageLive(stage({ deviceInfo: { devices: { redmi: entry(), fire: entry() } } }))
    expect(live.links.usb!.status).toBe('off')
  })

  it('condition and battery: dropouts are a fault, an unsure band time and a low battery a warning', () => {
    const vitals = (issues: ('audioMissing' | 'clockUnsure')[]) => ({ level: 'warning' as const, issues, memAvailMb: null, audioClockPct: null, stallsPerMin: 0, uptimeMin: 5 })
    const live = stageLive(stage({ deviceInfo: { devices: { redmi: entry({ vitals: vitals(['audioMissing']), midiOutputs: ['Kemper Player'] }), fire: entry({ vitals: vitals(['clockUnsure']), battery: { pct: 12, charging: false } }) } } }))
    expect(live.equipment['device:redmi']!.status).toBe('error')
    expect(live.equipment['device:fire']!.status).toBe('warning')
    expect(live.equipment['device:fire']!.notes).toEqual([{ status: 'ok', key: 'online' }, { status: 'warning', key: 'vitals', issue: 'clockUnsure' }, { status: 'warning', key: 'batteryLow', pct: 12 }])
    // Low but on the charger is fine.
    const charging = stageLive(stage({ deviceInfo: { devices: { redmi: entry(), fire: entry({ battery: { pct: 12, charging: true } }) } } }))
    expect(charging.equipment['device:fire']!.status).toBe('ok')
  })

  it('a driver that stopped reporting, or reports offline, is a fault at the gear it drives', () => {
    const silent = stageLive(stage({ health: { plugins: { 'kemper-plugin': { status: 'online', lastSeenAt: NOW - 20_000 } } } }))
    expect(silent.equipment.kemper).toMatchObject({ status: 'error', notes: [{ key: 'driverSilent' }] })
    const failed = stageLive(stage({ health: { plugins: { 'kemper-plugin': { status: 'error', lastSeenAt: NOW } } } }))
    expect(keys(failed.equipment.kemper!.notes)).toEqual(['driverError'])
  })

  it('the latency value of what runs over a cable: missing, by hand, measured', () => {
    const profile = (output: string, source: LatencyProfileDoc['source']): LatencyProfileDoc => ({ deviceId: 'redmi', output, route: output === 'audio' ? 'wired' : null, latencyMs: 20, source }) as LatencyProfileDoc
    expect(stageLive(stage()).links.jack!.path).toBe('missing')
    const live = stageLive(stage({ profiles: [profile('audio', 'measured'), profile('ld-kemper', 'manual')] }))
    expect(live.links.jack!.path).toBe('measured')
    expect(live.links.usb!.path).toBe('manual')
  })

  it('the Stage-Server answers, does not, or none is set', () => {
    const withServer = (serverReachable: boolean | null) => {
      const input = stage({ serverReachable })
      const server = equipmentFrom(BUILTIN_MODELS.find((m) => m.kind === 'stage-server')!, 'server', 'Stage-Server')
      return stageLive({ ...input, equipment: [...input.equipment, server] }).equipment.server
    }
    expect(withServer(true)).toMatchObject({ status: 'ok', notes: [{ key: 'serverOnline' }] })
    expect(withServer(false)).toMatchObject({ status: 'error', notes: [{ key: 'serverOffline' }] })
    expect(withServer(null)).toMatchObject({ status: 'off', notes: [{ key: 'noServer' }] })
  })

  it('headphones pulled on the Redmi: the device and the cable its click leaves on turn red, from its report', () => {
    const live = stageLive(stage({ deviceInfo: { devices: { redmi: entry({ midiOutputs: ['Kemper Player'], silenced: ['click'] }), fire: entry() } } }))
    expect(live.equipment['device:redmi']!.status).toBe('error')
    expect(live.equipment['device:redmi']!.notes).toContainEqual({ status: 'error', key: 'outputMissing', sources: ['click'] })
    expect(live.links.jack).toMatchObject({ status: 'error', notes: [{ key: 'outputMissing', sources: ['click'] }] })
    // The MIDI cable is not affected.
    expect(live.links.usb!.status).toBe('ok')
  })

  it('this device knows its own silenced sources at once, ahead of its report', () => {
    expect(stageLive(stage({ ownDeviceId: 'redmi', ownSilenced: ['click'] })).links.jack!.status).toBe('error')
    expect(stageLive(stage({ ownDeviceId: 'redmi', ownSilenced: [] })).links.jack!.status).not.toBe('error')
  })

  it('the band clock as a number; "unsure" turns that number into the warning instead of a second note', () => {
    const vitals = (issues: ('clockUnsure' | 'stalls')[]) => ({ level: 'ok' as const, issues, memAvailMb: null, audioClockPct: null, stallsPerMin: 0, uptimeMin: 5, clockUncertaintyMs: 3.2 })
    const sure = stageLive(stage({ deviceInfo: { devices: { redmi: entry({ vitals: vitals([]) }), fire: entry() } } }))
    expect(sure.equipment['device:redmi']!.notes).toContainEqual({ status: 'ok', key: 'clock', ms: 3.2 })
    const unsure = stageLive(stage({ deviceInfo: { devices: { redmi: entry({ vitals: vitals(['clockUnsure']) }), fire: entry() } } }))
    const notes = unsure.equipment['device:redmi']!.notes
    expect(notes).toContainEqual({ status: 'warning', key: 'clock', ms: 3.2 })
    expect(notes.some((n) => n.key === 'vitals' && n.issue === 'clockUnsure')).toBe(false)
    // An older app without the number keeps the plain "unsure".
    const old = stageLive(stage({ deviceInfo: { devices: { redmi: entry({ vitals: { ...vitals(['clockUnsure']), clockUncertaintyMs: undefined } }), fire: entry() } } }))
    expect(old.equipment['device:redmi']!.notes).toContainEqual({ status: 'warning', key: 'vitals', issue: 'clockUnsure' })
  })
})
