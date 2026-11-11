import {
  AUDIO_OUTPUT,
  DEVICE_INFO_TIMEOUT_MS,
  HEALTH_TIMEOUT_MS,
  NATIVE_AUDIO_OUTPUT,
  SERVER_EXECUTION_TARGET,
  appsOf,
  type DeviceInfo,
  type DeviceInfoEntry,
  type LatencyProfileDoc,
  type PluginHealth,
  type SignalFlow,
  type StageEquipment,
  type StageSetup,
  type VitalsIssue,
} from 'shared-types'
import type { StagePathState } from './stagePaths'

/** As StatusDot: red only for faults, `off` where nothing is known or nothing is to tell. */
export type LiveStatus = 'ok' | 'warning' | 'error' | 'off'

/** One finding, as a text key (`live.*` in hardware.json) with its values. */
export interface LiveNote {
  status: LiveStatus
  key: 'offline' | 'appClosed' | 'placeholder' | 'online' | 'vitals' | 'battery' | 'batteryLow' | 'serverOnline' | 'serverOffline' | 'noServer' | 'driverOnline' | 'driverSilent' | 'driverError' | 'midiFound' | 'midiMissing' | 'midiUnknown'
  /** `issue`: a VitalsIssue (vitals); `name`: a driver's or a MIDI port's name; `pct`: battery. */
  issue?: VitalsIssue
  name?: string
  pct?: number
}

export interface LiveState {
  status: LiveStatus
  notes: LiveNote[]
}

export interface LiveLinkState extends LiveState {
  /** The latency value of what runs over the cable (docs/31 §5) - the weakest of them; null when
   * nothing timed runs over it. */
  path: StagePathState | null
}

export interface StageLive {
  equipment: Record<string, LiveState>
  links: Record<string, LiveLinkState>
}

export interface StageLiveInput {
  /** What stands in the setup. */
  equipment: readonly StageEquipment[]
  setup: StageSetup
  flows: readonly SignalFlow[]
  /** The Logical Devices that are not Klick/Track/Ansagen. */
  outputs: readonly { id: string; name: string; pluginId: string | null }[]
  /** The virtual port ids of Klick, Track and Ansagen. */
  builtInIds: readonly string[]
  deviceInfo: DeviceInfo
  /** Server time, ms. */
  now: number
  /** Whether the Stage-Server answers - null: none is set, or not asked yet. */
  serverReachable: boolean | null
  health: PluginHealth
  ownDeviceId: string
  /** What this device sees itself, fresher than its report - null when not known. */
  ownMidiOutputs: readonly string[] | null
  /** Device box id → the app in front there. */
  front: Readonly<Record<string, string>>
  profiles: readonly LatencyProfileDoc[]
}

const RANK: Record<LiveStatus, number> = { off: 0, ok: 1, warning: 2, error: 3 }
const worst = (notes: readonly LiveNote[]): LiveStatus => notes.reduce<LiveStatus>((w, n) => (RANK[n.status] > RANK[w] ? n.status : w), 'off')

/** Below this without a charger the map warns - a tablet lasts a set from here, not a gig. */
export const BATTERY_WARN_PCT = 20

const VITALS_ERRORS: readonly VitalsIssue[] = ['audioFallback', 'audioMissing', 'memoryLow']

/** ● calibrated · ◐ by hand · ○ no value yet (docs/31 §5, as in StagePathList). */
export const PATH_MARK: Record<StagePathState, string> = { measured: '●', manual: '◐', missing: '○' }

const PATH_RANK: Record<StagePathState, number> = { measured: 2, manual: 1, missing: 0 }

/** The app that sends for a device box: the one in front, else its first (as mapRoute). */
function appOf(box: StageEquipment, front: Readonly<Record<string, string>>): string | null {
  if (box.kind === 'stage-server') return SERVER_EXECUTION_TARGET
  const apps = appsOf(box)
  const inFront = front[box.id]
  return inFront && apps.includes(inFront) ? inFront : (box.deviceId ?? apps[0] ?? null)
}

/**
 * The live layer of the stage map (#747, docs/31 §9): what each device and each cable of a setup
 * reports right now. Pure - the map hands in what the stores know.
 *
 * - A StageBoard device: app open (its report is fresh), its condition (audio, band time, memory),
 *   battery. Not there counts as a fault: the check asks whether the stage is complete.
 * - The Stage-Server: answers or not.
 * - Other equipment: the driver (plugin) of every output that reaches it, and its MIDI port.
 * - A cable: its MIDI port is there on the sending device (red when not), and how good the
 *   latency value of what runs over it is.
 */
export function stageLive(input: StageLiveInput): StageLive {
  const { equipment, setup, flows, outputs, builtInIds, deviceInfo, now, serverReachable, health, ownDeviceId, ownMidiOutputs, front, profiles } = input
  const byId = new Map(equipment.map((e) => [e.id, e]))
  const fresh = (id: string): DeviceInfoEntry | null => {
    const info = deviceInfo.devices[id]
    return info && now - info.lastSeenAt <= DEVICE_INFO_TIMEOUT_MS ? info : null
  }
  const result: StageLive = { equipment: {}, links: {} }
  const gearNotes = new Map<string, LiveNote[]>()
  const addGear = (id: string, note: LiveNote) => {
    const list = gearNotes.get(id) ?? []
    if (!list.some((n) => n.key === note.key && n.name === note.name)) list.push(note)
    gearNotes.set(id, list)
  }

  // Cables first: their MIDI port and path value, which also tell about the gear at the far end.
  for (const link of setup.links) {
    const notes: LiveNote[] = []
    const ends = [byId.get(link.from.equipmentId), byId.get(link.to.equipmentId)]
    const box = ends.find((e) => e && (e.kind === 'stageboard' || e.kind === 'stage-server'))
    const other = ends.find((e) => e && e !== box)
    if (link.midiName && box) {
      const app = appOf(box, front)
      const seen = app === ownDeviceId && ownMidiOutputs ? ownMidiOutputs : app && app !== SERVER_EXECUTION_TARGET ? (fresh(app)?.midiOutputs ?? null) : null
      const note: LiveNote = seen === null ? { status: 'off', key: 'midiUnknown', name: link.midiName } : seen.includes(link.midiName) ? { status: 'ok', key: 'midiFound', name: link.midiName } : { status: 'error', key: 'midiMissing', name: link.midiName }
      notes.push(note)
      if (other && note.status === 'error') addGear(other.id, note)
    }

    let path: StagePathState | null = null
    for (const flow of flows) {
      if (!flow.hops.some((h) => h.linkId === link.id)) continue
      const origin = byId.get(flow.originEquipmentId)
      if (!origin || (origin.kind !== 'stageboard' && origin.kind !== 'stage-server')) continue
      const app = appOf(origin, front)
      if (!app) continue
      const virtualId = flow.key.slice(flow.originEquipmentId.length + 1)
      const own = profiles.filter((p) => p.deviceId === app && (builtInIds.includes(virtualId) ? p.output === AUDIO_OUTPUT || p.output === NATIVE_AUDIO_OUTPUT : p.output === virtualId))
      const state: StagePathState = own.length === 0 ? 'missing' : own.some((p) => p.source === 'measured') ? 'measured' : 'manual'
      if (path === null || PATH_RANK[state] < PATH_RANK[path]) path = state
    }
    result.links[link.id] = { status: worst(notes), notes, path }
  }

  // The driver of every output, at the gear its signal reaches first.
  for (const output of outputs) {
    if (!output.pluginId) continue
    const entry = health.plugins[output.pluginId]
    const note: LiveNote = !entry || now - entry.lastSeenAt > HEALTH_TIMEOUT_MS ? { status: 'error', key: 'driverSilent', name: output.name } : entry.status === 'online' ? { status: 'ok', key: 'driverOnline', name: output.name } : { status: 'error', key: entry.status === 'error' ? 'driverError' : 'driverSilent', name: output.name }
    for (const flow of flows) {
      if (flow.key.slice(flow.originEquipmentId.length + 1) !== output.id) continue
      const first = flow.hops[0]
      if (!first) continue
      const target = first.from.equipmentId === flow.originEquipmentId ? first.to.equipmentId : first.from.equipmentId
      addGear(target, note)
    }
  }

  for (const e of equipment) {
    const notes: LiveNote[] = []
    if (e.kind === 'stage-server') {
      notes.push(serverReachable === null ? { status: 'off', key: 'noServer' } : serverReachable ? { status: 'ok', key: 'serverOnline' } : { status: 'error', key: 'serverOffline' })
    } else if (e.kind === 'stageboard') {
      const apps = appsOf(e).filter((id) => id !== SERVER_EXECUTION_TARGET)
      if (apps.length === 0) notes.push({ status: 'off', key: 'placeholder' })
      else {
        const app = appOf(e, front)
        const info = (app && app !== SERVER_EXECUTION_TARGET ? fresh(app) : null) ?? apps.map(fresh).find((i) => i !== null) ?? null
        if (!info) {
          // On the network but the app closed is still not there for the show.
          const pinged = apps.some((id) => deviceInfo.devices[id]?.networkReachable === true)
          notes.push({ status: 'error', key: pinged ? 'appClosed' : 'offline' })
        } else {
          notes.push({ status: 'ok', key: 'online' })
          for (const issue of info.vitals?.issues ?? []) notes.push({ status: VITALS_ERRORS.includes(issue) ? 'error' : 'warning', key: 'vitals', issue })
          if (info.battery) notes.push(!info.battery.charging && info.battery.pct < BATTERY_WARN_PCT ? { status: 'warning', key: 'batteryLow', pct: info.battery.pct } : { status: 'ok', key: 'battery', pct: info.battery.pct })
        }
      }
    }
    notes.push(...(gearNotes.get(e.id) ?? []))
    result.equipment[e.id] = { status: worst(notes), notes }
  }
  return result
}
