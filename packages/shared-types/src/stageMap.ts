import { z } from 'zod'
import { CAPABILITIES, type CapabilityId } from './capability.js'

/**
 * The stage map (docs/31 §0a, §7, §7a): the band's equipment with its physical ports, the cables
 * between them, and the soft-patch of StageBoard's virtual ports (Logical Devices: "Klick",
 * "Kemper", "Licht" …) onto those cables - one patch per setup ("Proberaum", "Club"). The map is
 * the one place that decides where a virtual port physically comes out (Marco, 2026-11-06).
 *
 * Data only - nothing reads it yet to decide who plays what; that switch comes as its own step.
 */

/** What a port carries. USB carries several at once; a cable carries what both ends share. */
export const SignalSchema = z.enum(['audio', 'usb-audio', 'midi', 'dmx', 'net', 'light'])
export type Signal = z.infer<typeof SignalSchema>

/** The signal classes a path runs in (Ton, MIDI, Licht) - one correction per path and class. */
export type SignalClass = 'sound' | 'midi' | 'light'

export const SIGNAL_CLASS: Record<Signal, SignalClass> = {
  audio: 'sound',
  'usb-audio': 'sound',
  midi: 'midi',
  dmx: 'light',
  net: 'light',
  light: 'light',
}

/** The plug. Only for the lenient check: a different connector warns ("Adapter nötig"), it never
 * blocks (decision 2). `builtin`, `wireless`, `ear`, `eye`, `room` are no real plugs and fit
 * anything; `xlr-jack` is a combo socket. */
export const ConnectorSchema = z.enum([
  'din5',
  'usb-a',
  'usb-b',
  'usb-c',
  'xlr',
  'jack-6.3',
  'jack-3.5',
  'xlr-jack',
  'ethernet',
  'dmx',
  'builtin',
  'wireless',
  'ear',
  'eye',
  'room',
])
export type Connector = z.infer<typeof ConnectorSchema>

export const PortDirectionSchema = z.enum(['in', 'out', 'both'])
export type PortDirection = z.infer<typeof PortDirectionSchema>

/** One physical port. `channels`: a group ("Eingänge 1–16") instead of 16 ports - a cable then
 * names the channel it uses. */
export const PortSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  connector: ConnectorSchema,
  signals: z.array(SignalSchema).min(1),
  direction: PortDirectionSchema,
  channels: z.number().int().min(2).max(128).optional(),
})
export type Port = z.infer<typeof PortSchema>

export const EquipmentKindSchema = z.enum([
  'stageboard',
  'stage-server',
  'mixer',
  'audio-interface',
  'midi-device',
  'amp-modeller',
  'iem-sender',
  'wedge',
  'pa',
  'light',
  'person',
  'hall',
])
export type EquipmentKind = z.infer<typeof EquipmentKindSchema>

/** Where a path ends: whoever hears or sees it. */
export const LISTENER_KINDS: readonly EquipmentKind[] = ['person', 'hall']
/** Where a path starts: the gear StageBoard itself drives from. */
export const DRIVER_KINDS: readonly EquipmentKind[] = ['stageboard', 'stage-server']

/**
 * A model of equipment in three layers (docs/31 §7): built in (generic), brought by a plugin
 * (`pluginId`, the manifest declares the ports), or the band's own copy (admin only).
 * `sounds`: the gear turns MIDI into sound (a Kemper) - a MIDI path goes on as sound.
 */
export const EquipmentModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: EquipmentKindSchema,
  source: z.enum(['builtin', 'plugin', 'band']),
  pluginId: z.string().min(1).nullable().default(null),
  sounds: z.boolean().default(false),
  ports: z.array(PortSchema),
})
export type EquipmentModel = z.infer<typeof EquipmentModelSchema>

/** Who a person node is: a fixed member, or whoever is signed in on a device (the default map). */
export const ListenerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('profile'), profileId: z.string().min(1) }),
  z.object({ kind: z.literal('signed-in'), deviceId: z.string().min(1) }),
])
export type Listener = z.infer<typeof ListenerSchema>

/**
 * One piece of equipment on the band's stage. `kind`, `sounds` and `ports` are copied from its
 * model when it is added (the band keeps only the ports it uses, decision 4), so a map stays
 * readable when a plugin is gone; `modelId` is what a model swap starts from.
 */
export const StageEquipmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  modelId: z.string().min(1),
  kind: EquipmentKindSchema,
  sounds: z.boolean().default(false),
  ports: z.array(PortSchema),
  /** The StageBoard device this is (kind `stageboard`). */
  deviceId: z.string().min(1).nullable().default(null),
  /** Who this is (kind `person`). */
  listener: ListenerSchema.nullable().default(null),
})
export type StageEquipment = z.infer<typeof StageEquipmentSchema>

/** One end of a cable: a port of a piece of equipment, and the channel inside a port group. */
export const PortRefSchema = z.object({
  equipmentId: z.string().min(1),
  portId: z.string().min(1),
  channel: z.number().int().positive().optional(),
})
export type PortRef = z.infer<typeof PortRefSchema>

/**
 * A cable (or radio link) from an output to an input. `signals`: what it carries - those both
 * ends share. `routes`: where the target sends it on, as outputs of the target - the boxes ticked
 * per mixer input ("Kanal 15 → Aux 1, Aux 2", Marco 2026-11-06). Into a mixer, no routes means it
 * goes nowhere: a mixer never passes the click to Main by assumption (docs/28). Other gear without
 * routes passes everything to all its outputs of the same class.
 */
export const StageLinkSchema = z.object({
  id: z.string().min(1),
  from: PortRefSchema,
  to: PortRefSchema,
  signals: z.array(SignalSchema).min(1),
  routes: z.array(PortRefSchema.omit({ equipmentId: true })).optional(),
})
export type StageLink = z.infer<typeof StageLinkSchema>

/**
 * A patch point (docs/31 §7a): a virtual port (Logical Device id) onto a cable at a StageBoard
 * device - an output onto a cable leaving it, an input ("Pedal") onto one arriving. A virtual
 * output may be patched onto several cables; each is a path of its own.
 */
export const PatchPointSchema = z.object({
  virtualPortId: z.string().min(1),
  linkId: z.string().min(1),
})
export type PatchPoint = z.infer<typeof PatchPointSchema>

/** One setup of the stage ("Proberaum", "Club"): which equipment stands where, the cables, the
 * patch. Chosen by hand in the Gig. */
export const StageSetupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
  links: z.array(StageLinkSchema),
  patch: z.array(PatchPointSchema),
})
export type StageSetup = z.infer<typeof StageSetupSchema>

export const StageMapSchema = z.object({
  equipment: z.array(StageEquipmentSchema),
  setups: z.array(StageSetupSchema).min(1),
})
export type StageMap = z.infer<typeof StageMapSchema>

const port = (id: string, name: string, connector: Connector, signals: Signal[], direction: PortDirection, channels?: number): Port =>
  channels === undefined ? { id, name, connector, signals, direction } : { id, name, connector, signals, direction, channels }

const builtin = (id: string, name: string, kind: EquipmentKind, ports: Port[], sounds = false): EquipmentModel => ({
  id,
  name,
  kind,
  source: 'builtin',
  pluginId: null,
  sounds,
  ports,
})

/** The generic models every band has without any plugin (docs/31 §7, layer 1). Names are German
 * defaults - the band renames the equipment, not the model. */
export const BUILTIN_MODELS: readonly EquipmentModel[] = [
  builtin('tablet', 'Tablet / Handy', 'stageboard', [
    port('speaker', 'Lautsprecher', 'builtin', ['audio'], 'out'),
    port('headphones', 'Kopfhörer', 'jack-3.5', ['audio'], 'out'),
    port('usb', 'USB-C', 'usb-c', ['usb-audio', 'midi'], 'both'),
    port('bluetooth', 'Bluetooth', 'wireless', ['audio'], 'out'),
  ]),
  builtin('stage-server', 'Stage-Server', 'stage-server', [
    port('net', 'Netzwerk', 'ethernet', ['net'], 'both'),
    port('usb', 'USB', 'usb-a', ['midi', 'dmx'], 'both'),
  ]),
  builtin('mixer', 'Mischpult', 'mixer', [
    port('in', 'Eingänge', 'xlr-jack', ['audio'], 'in', 16),
    port('main', 'Main Out L/R', 'xlr', ['audio'], 'out'),
    port('aux', 'Aux / Monitor', 'xlr-jack', ['audio'], 'out', 4),
  ]),
  builtin('audio-interface', 'Audio-Interface', 'audio-interface', [
    port('usb', 'USB', 'usb-b', ['usb-audio', 'midi'], 'both'),
    port('out12', 'Out 1/2', 'jack-6.3', ['audio'], 'out'),
  ]),
  builtin('midi-device', 'MIDI-Gerät', 'midi-device', [port('midi-in', 'MIDI In', 'din5', ['midi'], 'in'), port('main', 'Audio Out', 'jack-6.3', ['audio'], 'out')], true),
  builtin(
    'amp-modeller',
    'Amp-Modeller',
    'amp-modeller',
    [port('midi-in', 'MIDI In', 'din5', ['midi'], 'in'), port('usb', 'USB', 'usb-b', ['midi'], 'both'), port('main', 'Main Out', 'jack-6.3', ['audio'], 'out')],
    true,
  ),
  builtin('iem-sender', 'In-Ear-Sender', 'iem-sender', [port('in', 'Eingang', 'xlr-jack', ['audio'], 'in'), port('out', 'Funk', 'wireless', ['audio'], 'out')]),
  builtin('wedge', 'Monitor / Wedge', 'wedge', [port('in', 'Eingang', 'xlr-jack', ['audio'], 'in'), port('out', 'Schall', 'room', ['audio'], 'out')]),
  builtin('pa', 'PA', 'pa', [port('in', 'Eingang L/R', 'xlr', ['audio'], 'in'), port('out', 'Schall', 'room', ['audio'], 'out')]),
  builtin('light', 'Licht', 'light', [
    port('dmx', 'DMX In', 'dmx', ['dmx'], 'in'),
    port('net', 'Art-Net', 'ethernet', ['net'], 'in'),
    port('out', 'Licht', 'room', ['light'], 'out'),
  ]),
  builtin('person', 'Person', 'person', [port('ears', 'Ohren', 'ear', ['audio'], 'in')]),
  builtin('hall', 'Saal', 'hall', [port('ears', 'Ohren', 'ear', ['audio'], 'in'), port('eyes', 'Augen', 'eye', ['light'], 'in')]),
]

/** Plugs that are no real plug - they fit anything. */
const SOFT_CONNECTORS: readonly Connector[] = ['builtin', 'wireless', 'ear', 'eye', 'room']
const USB_CONNECTORS: readonly Connector[] = ['usb-a', 'usb-b', 'usb-c']

function connectorsFit(from: Connector, to: Connector): boolean {
  if (from === to || SOFT_CONNECTORS.includes(from) || SOFT_CONNECTORS.includes(to)) return true
  if (USB_CONNECTORS.includes(from) && USB_CONNECTORS.includes(to)) return true
  // A combo socket takes XLR and a 6.3 mm jack - a 3.5 mm plug still needs an adapter.
  if (to === 'xlr-jack' || from === 'xlr-jack') return [from, to].every((c) => c === 'xlr' || c === 'jack-6.3' || c === 'xlr-jack')
  return false
}

export interface PortFit {
  signals: Signal[]
  /** A connector mismatch: the cable is allowed, it just needs an adapter. */
  adapter: boolean
}

/**
 * Whether a cable may run from `from` to `to` (decision 2, lenient): an output into an input
 * sharing at least one signal. Null: not possible. A different plug only sets `adapter`.
 */
export function portFit(from: Port, to: Port): PortFit | null {
  if (from.direction === 'in' || to.direction === 'out') return null
  const signals = from.signals.filter((s) => to.signals.includes(s))
  if (signals.length === 0) return null
  return { signals, adapter: !connectorsFit(from.connector, to.connector) }
}

/** The virtual outputs every band starts with (docs/31 §7a): ordinary Logical Devices - renamable
 * and duplicable ("Klick Drums") - with these ids so the default map can patch them. */
export const DEFAULT_VIRTUAL_OUTPUTS: readonly { id: string; name: string; capability: CapabilityId }[] = [
  { id: 'klick', name: 'Klick', capability: CAPABILITIES.clickTrack },
  { id: 'track', name: 'Track', capability: CAPABILITIES.audioPlayback },
  { id: 'ansagen', name: 'Ansagen', capability: CAPABILITIES.sectionAnnouncements },
]

const SPEAKER_PORT = 'speaker'
const EARS_PORT = 'ears'
export const DEFAULT_SETUP_ID = 'standard'

function modelById(id: string): EquipmentModel {
  const model = BUILTIN_MODELS.find((m) => m.id === id)
  if (!model) throw new Error(`unknown built-in model ${id}`)
  return model
}

/** A piece of equipment from a model, with all the model's ports. */
export function equipmentFrom(model: EquipmentModel, id: string, name: string, extra: Partial<Pick<StageEquipment, 'deviceId' | 'listener'>> = {}): StageEquipment {
  return {
    id,
    name,
    modelId: model.id,
    kind: model.kind,
    sounds: model.sounds,
    ports: model.ports.map((p) => ({ ...p, signals: [...p.signals] })),
    deviceId: extra.deviceId ?? null,
    listener: extra.listener ?? null,
  }
}

export const deviceEquipmentId = (deviceId: string): string => `device:${deviceId}`
export const signedInListenerId = (deviceId: string): string => `listener:${deviceId}`

/**
 * Adds a StageBoard device the default way (decision 6): the device, whoever is signed in on it,
 * its speaker to them, and the given virtual outputs patched onto that cable - in every setup.
 * Unchanged when the device is on the map already (the band may have moved it on purpose).
 */
export function addDeviceToMap(map: StageMap, device: { id: string; name: string }, virtualOutputIds: readonly string[]): StageMap {
  const equipmentId = deviceEquipmentId(device.id)
  if (map.equipment.some((e) => e.id === equipmentId || e.deviceId === device.id)) return map
  const listenerId = signedInListenerId(device.id)
  const linkId = `default:${device.id}`
  const equipment = [
    ...map.equipment,
    equipmentFrom(modelById('tablet'), equipmentId, device.name, { deviceId: device.id }),
    equipmentFrom(modelById('person'), listenerId, 'Angemeldet', { listener: { kind: 'signed-in', deviceId: device.id } }),
  ]
  const index = map.equipment.filter((e) => e.kind === 'stageboard').length
  const setups = map.setups.map((setup) => ({
    ...setup,
    positions: { ...setup.positions, [equipmentId]: { x: 140 + index * 260, y: 420 }, [listenerId]: { x: 140 + index * 260, y: 200 } },
    links: [...setup.links, { id: linkId, from: { equipmentId, portId: SPEAKER_PORT }, to: { equipmentId: listenerId, portId: EARS_PORT }, signals: ['audio' as const] }],
    patch: [...setup.patch, ...virtualOutputIds.map((virtualPortId) => ({ virtualPortId, linkId }))],
  }))
  return { equipment, setups }
}

/** The map of a band that has none yet (decision 6): every known device plays Klick, Track and
 * Ansagen on its own speaker for whoever is signed in - not tied to the master. */
export function defaultStageMap(devices: readonly { id: string; name: string }[], virtualOutputIds: readonly string[] = DEFAULT_VIRTUAL_OUTPUTS.map((v) => v.id)): StageMap {
  const empty: StageMap = { equipment: [], setups: [{ id: DEFAULT_SETUP_ID, name: 'Standard', positions: {}, links: [], patch: [] }] }
  return devices.reduce((map, device) => addDeviceToMap(map, device, virtualOutputIds), empty)
}

/**
 * One physical path (docs/31 §7): a cable leaving a StageBoard device, followed in one signal
 * class through passive gear to whoever hears or sees it. Gear that sounds carries a MIDI path on
 * as sound. A mixer passes a signal only to the outputs ticked on the cable into it.
 */
export interface StagePath {
  /** Stable across setups: the same physical cable start keeps its correction value. */
  key: string
  start: StageLink
  signalClass: SignalClass
  /** Every cable on the path, the start first. */
  linkIds: string[]
  /** The person/hall equipment at its end (none: the path ends nowhere yet). */
  listenerIds: string[]
  /** The virtual ports patched onto its start cable. */
  virtualPortIds: string[]
}

export function stagePathKey(link: StageLink, signalClass: SignalClass): string {
  const end = (ref: PortRef) => `${ref.equipmentId}.${ref.portId}${ref.channel === undefined ? '' : `#${ref.channel}`}`
  return `${end(link.from)}>${end(link.to)}:${signalClass}`
}

const classesOf = (signals: readonly Signal[]): SignalClass[] => [...new Set(signals.map((s) => SIGNAL_CLASS[s]))]

/** All paths of a setup, in the order of its cables. */
export function stagePaths(map: StageMap, setupId: string): StagePath[] {
  const setup = map.setups.find((s) => s.id === setupId)
  if (!setup) return []
  const byId = new Map(map.equipment.map((e) => [e.id, e]))
  const paths: StagePath[] = []
  for (const start of setup.links) {
    const driver = byId.get(start.from.equipmentId)
    if (!driver || !DRIVER_KINDS.includes(driver.kind)) continue
    for (const signalClass of classesOf(start.signals)) {
      const linkIds = [start.id]
      const listenerIds: string[] = []
      const queue: { link: StageLink; signalClass: SignalClass }[] = [{ link: start, signalClass }]
      const seen = new Set<string>()
      while (queue.length > 0) {
        const { link, signalClass: cls } = queue.shift()!
        const visit = `${link.id}:${cls}`
        if (seen.has(visit)) continue
        seen.add(visit)
        const target = byId.get(link.to.equipmentId)
        if (!target || DRIVER_KINDS.includes(target.kind)) continue
        if (LISTENER_KINDS.includes(target.kind)) {
          if (!listenerIds.includes(target.id)) listenerIds.push(target.id)
          continue
        }
        const onward: SignalClass[] = target.sounds && cls === 'midi' ? ['midi', 'sound'] : [cls]
        for (const next of setup.links) {
          if (next.from.equipmentId !== target.id) continue
          if (!passes(target, link, next)) continue
          const nextClass = classesOf(next.signals).find((c) => onward.includes(c))
          if (!nextClass) continue
          if (!linkIds.includes(next.id)) linkIds.push(next.id)
          queue.push({ link: next, signalClass: nextClass })
        }
      }
      paths.push({
        key: stagePathKey(start, signalClass),
        start,
        signalClass,
        linkIds,
        listenerIds,
        virtualPortIds: setup.patch.filter((p) => p.linkId === start.id).map((p) => p.virtualPortId),
      })
    }
  }
  return paths
}

/** Whether `target` sends what arrives over `into` on over `out`: a mixer only to the ticked
 * outputs, other gear everywhere. */
function passes(target: StageEquipment, into: StageLink, out: StageLink): boolean {
  const routes = into.routes
  if (routes === undefined) return target.kind !== 'mixer'
  return routes.some((r) => r.portId === out.from.portId && (r.channel === undefined || out.from.channel === undefined || r.channel === out.from.channel))
}
