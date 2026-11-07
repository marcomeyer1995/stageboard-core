import { z } from 'zod'
import { CAPABILITIES, type CapabilityId } from './capability.js'

/**
 * The stage map (docs/31 §0a, §7, §7a): the band's equipment with its physical ports, the cables
 * between them, and per setup a routing matrix for every device that routes - which input goes to
 * which output (Marco, 2026-11-06). On a StageBoard device the inputs include StageBoard's virtual
 * sources (Logical Devices: "Klick", "Kemper" …) and the outputs its virtual inputs ("Pedal"):
 * the matrix is the soft-patch. The map is the one place that decides where a virtual port
 * physically comes out.
 *
 * Data only - nothing reads it yet to decide who plays what; that switch comes as its own step.
 */

/** What a port carries. USB carries several at once; a cable carries what both ends share. */
export const SignalSchema = z.enum(['audio', 'usb-audio', 'midi', 'dmx', 'net', 'light'])
export type Signal = z.infer<typeof SignalSchema>

/** The signal classes a path runs in (Ton, MIDI, Licht). */
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
  /** 6.3 mm mono/unbalanced (TS) - the CQ-18T's Aux outs (Marco, 2026-11-07); `jack-6.3` is TRS. */
  'jack-6.3-ts',
  'jack-3.5',
  'rca',
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

/** One physical port. `channels`: a group ("Eingänge 1–16") instead of 16 ports - a cable and a
 * matrix point then name the channel. */
export const PortSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  connector: ConnectorSchema,
  signals: z.array(SignalSchema).min(1),
  direction: PortDirectionSchema,
  channels: z.number().int().min(2).max(128).optional(),
  /** The desk's number of channel 1 of this group ("XLR 11–20" after 10 combo inputs) - labels only. */
  firstChannel: z.number().int().min(1).max(256).optional(),
})
export type Port = z.infer<typeof PortSchema>

export const EquipmentKindSchema = z.enum([
  'stageboard',
  'stage-server',
  'mixer',
  'audio-interface',
  'midi-device',
  'midi-controller',
  'amp-modeller',
  'iem-sender',
  'iem-receiver',
  'mic-sender',
  'mic-receiver',
  'di-box',
  'stagebox',
  'headphone-amp',
  'instrument-amp',
  'microphone',
  'instrument',
  'wedge',
  'pa',
  'light',
  'person',
  'hall',
])
export type EquipmentKind = z.infer<typeof EquipmentKindSchema>

/** Where a path ends: whoever hears or sees it. */
export const LISTENER_KINDS: readonly EquipmentKind[] = ['person', 'hall']
/** StageBoard itself: its matrix has the virtual ports. */
export const DRIVER_KINDS: readonly EquipmentKind[] = ['stageboard', 'stage-server']

/** One row or column of a routing matrix: a physical port (one channel of a group), or a virtual
 * port of StageBoard (a Logical Device id) on a StageBoard device. */
export const MatrixPointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('port'), portId: z.string().min(1), channel: z.number().int().positive().optional() }),
  z.object({ kind: z.literal('virtual'), virtualPortId: z.string().min(1) }),
])
export type MatrixPoint = z.infer<typeof MatrixPointSchema>

/** A ticked cell: this input goes to this output. */
export const CrosspointSchema = z.object({ from: MatrixPointSchema, to: MatrixPointSchema })
export type Crosspoint = z.infer<typeof CrosspointSchema>

/**
 * How a model routes inside (Marco, 2026-11-06: defined gear by gear). `fixed`: it cannot be
 * repatched (an In-Ear sender's input always goes out by radio) - shown greyed. `free`: the band
 * ticks it, starting from `default` (a generic mixer starts empty: nothing reaches Main by
 * assumption, docs/28). No routing at all: the gear only listens (a person, the hall).
 */
export const RoutingSchema = z.object({
  mode: z.enum(['fixed', 'free']),
  default: z.array(CrosspointSchema),
})
export type Routing = z.infer<typeof RoutingSchema>

/**
 * A model of equipment in three layers (docs/31 §7): built in (generic), brought by a plugin
 * (`pluginId`, the manifest declares the ports), or the band's own copy (admin only).
 * `sounds`: the gear turns MIDI into sound (a Kemper) - a MIDI signal goes on as sound where its
 * matrix routes a MIDI input to an audio output.
 */
export const EquipmentModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: EquipmentKindSchema,
  source: z.enum(['builtin', 'plugin', 'band']),
  pluginId: z.string().min(1).nullable().default(null),
  sounds: z.boolean().default(false),
  ports: z.array(PortSchema),
  routing: RoutingSchema.nullable().default(null),
})
export type EquipmentModel = z.infer<typeof EquipmentModelSchema>

/** Who a person node is: a fixed member, or whoever is signed in on a device (the default map). */
export const ListenerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('profile'), profileId: z.string().min(1) }),
  z.object({ kind: z.literal('signed-in'), deviceId: z.string().min(1) }),
])
export type Listener = z.infer<typeof ListenerSchema>

/**
 * One piece of equipment on the band's stage. `kind`, `sounds`, `ports` and `routing` are copied
 * from its model when it is added (the band keeps only the ports it uses, decision 4), so a map
 * stays readable when a plugin is gone; `modelId` is what a model swap starts from.
 */
export const StageEquipmentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  modelId: z.string().min(1),
  kind: EquipmentKindSchema,
  sounds: z.boolean().default(false),
  ports: z.array(PortSchema),
  routing: RoutingSchema.nullable().default(null),
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

/** A cable (or radio link) between two ports. `signals`: what it carries - those both ends share.
 * A cable between two two-way ports (USB) carries signals both ways. */
export const StageLinkSchema = z.object({
  id: z.string().min(1),
  from: PortRefSchema,
  to: PortRefSchema,
  signals: z.array(SignalSchema).min(1),
})
export type StageLink = z.infer<typeof StageLinkSchema>

/** One setup of the stage ("Proberaum", "Club"): which equipment stands where, the cables, and the
 * ticked matrix of every device whose routing is free (absent: the model's default). Chosen by
 * hand in the Gig. */
export const StageSetupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
  links: z.array(StageLinkSchema),
  routing: z.record(z.string(), z.array(CrosspointSchema)),
})
export type StageSetup = z.infer<typeof StageSetupSchema>

export const StageMapSchema = z.object({
  equipment: z.array(StageEquipmentSchema),
  setups: z.array(StageSetupSchema).min(1),
})
export type StageMap = z.infer<typeof StageMapSchema>

const port = (id: string, name: string, connector: Connector, signals: Signal[], direction: PortDirection, channels?: number): Port =>
  channels === undefined ? { id, name, connector, signals, direction } : { id, name, connector, signals, direction, channels }

const at = (portId: string, channel?: number): MatrixPoint => (channel === undefined ? { kind: 'port', portId } : { kind: 'port', portId, channel })
const via = (from: MatrixPoint, to: MatrixPoint): Crosspoint => ({ from, to })
const fixed = (...crosspoints: Crosspoint[]): Routing => ({ mode: 'fixed', default: crosspoints })
const free = (...crosspoints: Crosspoint[]): Routing => ({ mode: 'free', default: crosspoints })

const builtin = (id: string, name: string, kind: EquipmentKind, ports: Port[], routing: Routing | null, sounds = false): EquipmentModel => ({
  id,
  name,
  kind,
  source: 'builtin',
  pluginId: null,
  sounds,
  ports,
  routing,
})

/** The virtual outputs every band starts with (docs/31 §7a): ordinary Logical Devices - renamable
 * and duplicable ("Klick Drums") - with these ids so the default routing can name them. */
export const DEFAULT_VIRTUAL_OUTPUTS: readonly { id: string; name: string; capability: CapabilityId }[] = [
  { id: 'klick', name: 'Klick', capability: CAPABILITIES.clickTrack },
  { id: 'track', name: 'Track', capability: CAPABILITIES.audioPlayback },
  { id: 'ansagen', name: 'Ansagen', capability: CAPABILITIES.sectionAnnouncements },
]

const virtual = (virtualPortId: string): MatrixPoint => ({ kind: 'virtual', virtualPortId })

/** The generic models every band has without any plugin (docs/31 §7, layer 1), each with its own
 * routing (Marco, 2026-11-06: defined gear by gear). Names are German defaults - the band renames
 * the equipment, not the model. */
export const BUILTIN_MODELS: readonly EquipmentModel[] = [
  builtin(
    'tablet',
    'Tablet / Handy',
    'stageboard',
    [
      port('speaker', 'Lautsprecher', 'builtin', ['audio'], 'out'),
      port('headphones', 'Kopfhörer', 'jack-3.5', ['audio'], 'out'),
      port('usb', 'USB-C', 'usb-c', ['usb-audio', 'midi'], 'both'),
      port('bluetooth', 'Bluetooth', 'wireless', ['audio'], 'out'),
      port('bt-midi', 'Bluetooth-MIDI', 'wireless', ['midi'], 'both'),
      port('wifi-midi', 'WLAN-MIDI', 'wireless', ['midi'], 'both'),
    ],
    // The default map (decision 6): Klick, Track and Ansagen on the device's own speaker.
    free(...DEFAULT_VIRTUAL_OUTPUTS.map((v) => via(virtual(v.id), at('speaker')))),
  ),
  builtin('stage-server', 'Stage-Server', 'stage-server', [port('net', 'Netzwerk', 'ethernet', ['net'], 'both'), port('usb', 'USB', 'usb-a', ['midi', 'dmx'], 'both')], free()),
  builtin(
    'mixer',
    'Mischpult',
    'mixer',
    [port('in', 'Eingang', 'xlr-jack', ['audio'], 'in', 16), port('main', 'Main L/R', 'xlr', ['audio'], 'out'), port('aux', 'Aux', 'xlr-jack', ['audio'], 'out', 4)],
    free(),
  ),
  builtin(
    'audio-interface',
    'Audio-Interface',
    'audio-interface',
    [port('usb', 'USB', 'usb-b', ['usb-audio', 'midi'], 'both'), port('out12', 'Out 1/2', 'jack-6.3', ['audio'], 'out')],
    free(via(at('usb'), at('out12'))),
  ),
  builtin('midi-device', 'MIDI-Gerät', 'midi-device', [port('midi-in', 'MIDI In', 'din5', ['midi'], 'in'), port('main', 'Audio Out', 'jack-6.3', ['audio'], 'out')], fixed(via(at('midi-in'), at('main'))), true),
  builtin('midi-controller', 'Pedal / Keyboard', 'midi-controller', [port('midi-out', 'MIDI Out', 'din5', ['midi'], 'out'), port('usb', 'USB', 'usb-b', ['midi'], 'both')], null),
  builtin(
    'amp-modeller',
    'Amp-Modeller',
    'amp-modeller',
    [port('midi-in', 'MIDI In', 'din5', ['midi'], 'in'), port('usb', 'USB', 'usb-b', ['midi'], 'both'), port('main', 'Main Out', 'jack-6.3', ['audio'], 'out')],
    fixed(via(at('midi-in'), at('main')), via(at('usb'), at('main'))),
    true,
  ),
  builtin('iem-sender', 'In-Ear-Sender', 'iem-sender', [port('in', 'Eingang', 'xlr-jack', ['audio'], 'in'), port('out', 'Funk', 'wireless', ['audio'], 'out')], fixed(via(at('in'), at('out')))),
  // The beltpack (Marco, 2026-11-07): the radio link from the sender shows as its own line, then the
  // earphones to the person.
  builtin('iem-receiver', 'In-Ear-Empfänger', 'iem-receiver', [port('in', 'Funk', 'wireless', ['audio'], 'in'), port('phones', 'Ohrhörer', 'jack-3.5', ['audio'], 'out')], fixed(via(at('in'), at('phones')))),
  // More gear on the stage (Marco, 2026-11-07): sources, wireless mics, DI and stagebox, amps.
  builtin('microphone', 'Mikrofon', 'microphone', [port('out', 'Ausgang', 'xlr', ['audio'], 'out')], null),
  builtin('instrument', 'Instrument', 'instrument', [port('out', 'Ausgang', 'jack-6.3', ['audio'], 'out')], null),
  builtin('mic-sender', 'Funkmikro (Sender)', 'mic-sender', [port('in', 'Kapsel/Eingang', 'jack-3.5', ['audio'], 'in'), port('out', 'Funk', 'wireless', ['audio'], 'out')], fixed(via(at('in'), at('out')))),
  builtin('mic-receiver', 'Funkmikro (Empfänger)', 'mic-receiver', [port('in', 'Funk', 'wireless', ['audio'], 'in'), port('out', 'Ausgang', 'xlr', ['audio'], 'out')], fixed(via(at('in'), at('out')))),
  builtin(
    'di-box',
    'DI-Box',
    'di-box',
    [port('in', 'Eingang', 'jack-6.3', ['audio'], 'in'), port('thru', 'Thru', 'jack-6.3', ['audio'], 'out'), port('out', 'Ausgang', 'xlr', ['audio'], 'out')],
    fixed(via(at('in'), at('out')), via(at('in'), at('thru'))),
  ),
  builtin(
    'stagebox',
    'Stagebox / Splitter',
    'stagebox',
    [port('in', 'Eingang', 'xlr-jack', ['audio'], 'in', 16), port('out', 'Multicore', 'xlr', ['audio'], 'out', 16)],
    fixed(...Array.from({ length: 16 }, (_, i) => via(at('in', i + 1), at('out', i + 1)))),
  ),
  builtin(
    'headphone-amp',
    'Kopfhörerverstärker',
    'headphone-amp',
    [port('in', 'Eingang', 'jack-6.3', ['audio'], 'in'), port('out', 'Kopfhörer', 'jack-6.3', ['audio'], 'out', 4)],
    fixed(...Array.from({ length: 4 }, (_, i) => via(at('in'), at('out', i + 1)))),
  ),
  builtin(
    'instrument-amp',
    'Instrumenten-Amp',
    'instrument-amp',
    [port('in', 'Eingang', 'jack-6.3', ['audio'], 'in'), port('line', 'Line Out', 'xlr', ['audio'], 'out'), port('out', 'Schall', 'room', ['audio'], 'out')],
    fixed(via(at('in'), at('out')), via(at('in'), at('line'))),
  ),
  builtin('wedge', 'Monitor / Wedge', 'wedge', [port('in', 'Eingang', 'xlr-jack', ['audio'], 'in'), port('out', 'Schall', 'room', ['audio'], 'out')], fixed(via(at('in'), at('out')))),
  builtin('pa', 'PA', 'pa', [port('in', 'Eingang L/R', 'xlr', ['audio'], 'in'), port('out', 'Schall', 'room', ['audio'], 'out')], fixed(via(at('in'), at('out')))),
  builtin(
    'light',
    'Licht',
    'light',
    [port('dmx', 'DMX In', 'dmx', ['dmx'], 'in'), port('net', 'Art-Net', 'ethernet', ['net'], 'in'), port('out', 'Licht', 'room', ['light'], 'out')],
    fixed(via(at('dmx'), at('out')), via(at('net'), at('out'))),
  ),
  builtin('person', 'Person', 'person', [port('ears', 'Ohren', 'ear', ['audio'], 'in')], null),
  builtin('hall', 'Saal', 'hall', [port('ears', 'Ohren', 'ear', ['audio'], 'in'), port('eyes', 'Augen', 'eye', ['light'], 'in')], null),
]

/** Plugs that are no real plug - they fit anything. */
const SOFT_CONNECTORS: readonly Connector[] = ['builtin', 'wireless', 'ear', 'eye', 'room']
const USB_CONNECTORS: readonly Connector[] = ['usb-a', 'usb-b', 'usb-c']

function connectorsFit(from: Connector, to: Connector): boolean {
  if (from === to || SOFT_CONNECTORS.includes(from) || SOFT_CONNECTORS.includes(to)) return true
  if (USB_CONNECTORS.includes(from) && USB_CONNECTORS.includes(to)) return true
  // TS and TRS are the same 6.3 mm plug.
  const jack = (c: Connector) => c === 'jack-6.3' || c === 'jack-6.3-ts'
  if (jack(from) && jack(to)) return true
  // A combo socket takes XLR and a 6.3 mm jack - a 3.5 mm plug still needs an adapter.
  if (to === 'xlr-jack' || from === 'xlr-jack') return [from, to].every((c) => c === 'xlr' || jack(c) || c === 'xlr-jack')
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

/** What a virtual port carries, from its capability: MIDI for anything a plugin drives, light for
 * the lighting desk, sound for click, track and announcements. */
export function virtualPortClass(capability: CapabilityId): SignalClass {
  if (capability === CAPABILITIES.clickTrack || capability === CAPABILITIES.audioPlayback || capability === CAPABILITIES.sectionAnnouncements) return 'sound'
  if (capability === CAPABILITIES.lighting) return 'light'
  return 'midi'
}

/** Whether a virtual port is an input of StageBoard (a pedal, a MIDI controller) - a row of the
 * matrix - or a source - a column. */
export function virtualPortIsInput(capability: CapabilityId): boolean {
  return capability === CAPABILITIES.midiInput || capability === CAPABILITIES.midiController
}

export const DEFAULT_SETUP_ID = 'standard'

function modelById(id: string): EquipmentModel {
  const model = BUILTIN_MODELS.find((m) => m.id === id)
  if (!model) throw new Error(`unknown built-in model ${id}`)
  return model
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** A piece of equipment from a model, with all the model's ports and its routing. */
export function equipmentFrom(model: EquipmentModel, id: string, name: string, extra: Partial<Pick<StageEquipment, 'deviceId' | 'listener'>> = {}): StageEquipment {
  return {
    id,
    name,
    modelId: model.id,
    kind: model.kind,
    sounds: model.sounds,
    ports: clone(model.ports),
    routing: clone(model.routing),
    deviceId: extra.deviceId ?? null,
    listener: extra.listener ?? null,
  }
}

export const deviceEquipmentId = (deviceId: string): string => `device:${deviceId}`
export const signedInListenerId = (deviceId: string): string => `listener:${deviceId}`
export const defaultLinkId = (deviceId: string): string => `default:${deviceId}`

/**
 * Adds a StageBoard device the default way (decision 6): the device - its matrix routes Klick,
 * Track and Ansagen to its speaker -, whoever is signed in on it, and the speaker to them, in
 * every setup. Unchanged when the device is on the map already (the band may have changed it).
 */
export function addDeviceToMap(map: StageMap, device: { id: string; name: string }): StageMap {
  const equipmentId = deviceEquipmentId(device.id)
  if (map.equipment.some((e) => e.id === equipmentId || e.deviceId === device.id)) return map
  const listenerId = signedInListenerId(device.id)
  const equipment = [
    ...map.equipment,
    equipmentFrom(modelById('tablet'), equipmentId, device.name, { deviceId: device.id }),
    equipmentFrom(modelById('person'), listenerId, 'Angemeldet', { listener: { kind: 'signed-in', deviceId: device.id } }),
  ]
  const index = map.equipment.filter((e) => e.kind === 'stageboard').length
  const setups = map.setups.map((setup) => ({
    ...setup,
    positions: { ...setup.positions, [equipmentId]: { x: 140 + index * 260, y: 420 }, [listenerId]: { x: 140 + index * 260, y: 200 } },
    links: [...setup.links, { id: defaultLinkId(device.id), from: { equipmentId, portId: 'speaker' }, to: { equipmentId: listenerId, portId: 'ears' }, signals: ['audio' as const] }],
  }))
  return { equipment, setups }
}

/** The map of a band that has none yet (decision 6): every known device plays Klick, Track and
 * Ansagen on its own speaker for whoever is signed in - not tied to the master. */
export function defaultStageMap(devices: readonly { id: string; name: string }[]): StageMap {
  const empty: StageMap = { equipment: [], setups: [{ id: DEFAULT_SETUP_ID, name: 'Standard', positions: {}, links: [], routing: {} }] }
  return devices.reduce((map, device) => addDeviceToMap(map, device), empty)
}

/** The crosspoints that apply to a device in a setup: a fixed routing always its own, a free one
 * what the band ticked, else its default. */
export function effectiveRouting(equipment: StageEquipment, setup: StageSetup): Crosspoint[] {
  if (!equipment.routing) return []
  if (equipment.routing.mode === 'fixed') return equipment.routing.default
  return setup.routing[equipment.id] ?? equipment.routing.default
}

/** A virtual port of the band - what a StageBoard device's matrix offers. */
export interface VirtualPort {
  id: string
  name: string
  signalClass: SignalClass
  input: boolean
}

/** One step of a signal's way: the cable, and where it enters and leaves the next device. */
export interface SignalHop {
  linkId: string
  from: PortRef
  to: PortRef
}

/**
 * One signal on the stage (docs/31): a virtual source routed out of a StageBoard device (Klick on
 * Redmi), or what a source of its own sends (a pedal) - followed through every matrix to where it
 * ends: whoever hears or sees it, or a virtual input ("Pedal"). Several branches when it fans out.
 */
export interface SignalFlow {
  /** `<equipment>/<virtual port or port>` - stable across setups. */
  key: string
  name: string
  signalClass: SignalClass
  originEquipmentId: string
  /** Every cable it runs over, in the order found. */
  hops: SignalHop[]
  /** The listeners it reaches. */
  listenerIds: string[]
  /** Virtual inputs it reaches: `<equipment>/<virtual port>`. */
  virtualInputs: { equipmentId: string; virtualPortId: string }[]
}

const pointMatches = (point: MatrixPoint, portId: string, channel: number | undefined): boolean =>
  point.kind === 'port' && point.portId === portId && (point.channel === undefined || channel === undefined || point.channel === channel)

/** The class a signal has on `port`, or null when the port cannot carry it. Gear that sounds
 * turns MIDI into sound. */
function classOn(port: Port, cls: SignalClass, sounds: boolean): SignalClass | null {
  const classes = port.signals.map((s) => SIGNAL_CLASS[s])
  if (classes.includes(cls)) return cls
  if (sounds && cls === 'midi' && classes.includes('sound')) return 'sound'
  return null
}

/**
 * Every signal of a setup and where it goes. `virtualPorts`: the band's virtual ports (names and
 * classes); an unknown id is shown by its id, as sound.
 */
export function signalFlows(map: StageMap, setupId: string, virtualPorts: readonly VirtualPort[]): SignalFlow[] {
  const setup = map.setups.find((s) => s.id === setupId)
  if (!setup) return []
  const byId = new Map(map.equipment.map((e) => [e.id, e]))
  const onStage = map.equipment.filter((e) => setup.positions[e.id])
  const flows: SignalFlow[] = []

  // Cables leaving `equipment` at (port, channel) that can carry `cls` away from it.
  const cablesOut = (equipment: StageEquipment, portId: string, channel: number | undefined, cls: SignalClass) => {
    const out: { link: StageLink; from: PortRef; to: PortRef }[] = []
    for (const link of setup.links) {
      if (!link.signals.some((s) => SIGNAL_CLASS[s] === cls)) continue
      for (const [mine, theirs] of [
        [link.from, link.to],
        [link.to, link.from],
      ] as const) {
        if (mine.equipmentId !== equipment.id || mine.portId !== portId) continue
        if (channel !== undefined && mine.channel !== undefined && mine.channel !== channel) continue
        const myPort = equipment.ports.find((p) => p.id === portId)
        const other = byId.get(theirs.equipmentId)
        const theirPort = other?.ports.find((p) => p.id === theirs.portId)
        if (!myPort || !theirPort || myPort.direction === 'in' || theirPort.direction === 'out') continue
        out.push({ link, from: mine, to: theirs })
      }
    }
    return out
  }

  const follow = (flow: SignalFlow, start: { equipment: StageEquipment; portId: string; channel: number | undefined; cls: SignalClass }[]) => {
    const queue = [...start]
    const seen = new Set<string>()
    while (queue.length > 0) {
      const { equipment, portId, channel, cls } = queue.shift()!
      for (const cable of cablesOut(equipment, portId, channel, cls)) {
        const visit = `${cable.link.id}>${cable.to.equipmentId}:${cls}`
        if (seen.has(visit)) continue
        seen.add(visit)
        const target = byId.get(cable.to.equipmentId)
        const inPort = target?.ports.find((p) => p.id === cable.to.portId)
        if (!target || !inPort || !classOn(inPort, cls, false)) continue
        flow.hops.push({ linkId: cable.link.id, from: cable.from, to: cable.to })
        if (LISTENER_KINDS.includes(target.kind)) {
          if (!flow.listenerIds.includes(target.id)) flow.listenerIds.push(target.id)
          continue
        }
        const inChannel = cable.to.channel
        for (const cross of effectiveRouting(target, setup)) {
          if (!pointMatches(cross.from, cable.to.portId, inChannel)) continue
          if (cross.to.kind === 'virtual') {
            if (DRIVER_KINDS.includes(target.kind)) flow.virtualInputs.push({ equipmentId: target.id, virtualPortId: cross.to.virtualPortId })
            continue
          }
          const outPort = target.ports.find((p) => p.id === (cross.to as { portId: string }).portId)
          const nextCls = outPort ? classOn(outPort, cls, target.sounds) : null
          if (!outPort || !nextCls) continue
          queue.push({ equipment: target, portId: outPort.id, channel: cross.to.channel ?? (outPort.channels ? undefined : inChannel), cls: nextCls })
        }
      }
    }
  }

  for (const equipment of onStage) {
    if (DRIVER_KINDS.includes(equipment.kind)) {
      // StageBoard's virtual sources, routed out by the device's matrix.
      const routing = effectiveRouting(equipment, setup)
      const sources = [...new Set(routing.flatMap((c) => (c.from.kind === 'virtual' ? [c.from.virtualPortId] : [])))]
      for (const id of sources) {
        const vp = virtualPorts.find((v) => v.id === id)
        const cls = vp?.signalClass ?? 'sound'
        const flow: SignalFlow = { key: `${equipment.id}/${id}`, name: vp?.name ?? id, signalClass: cls, originEquipmentId: equipment.id, hops: [], listenerIds: [], virtualInputs: [] }
        const starts = routing
          .filter((c) => c.from.kind === 'virtual' && c.from.virtualPortId === id && c.to.kind === 'port')
          .flatMap((c) => {
            const to = c.to as { portId: string; channel?: number }
            const p = equipment.ports.find((x) => x.id === to.portId)
            return p && classOn(p, cls, false) ? [{ equipment, portId: p.id, channel: to.channel, cls }] : []
          })
        follow(flow, starts)
        flows.push(flow)
      }
    } else if (!equipment.ports.some((p) => p.direction === 'in')) {
      // A source of its own (a pedal): each output sends what it carries.
      for (const p of equipment.ports) {
        for (const cls of [...new Set(p.signals.map((s) => SIGNAL_CLASS[s]))]) {
          const flow: SignalFlow = { key: `${equipment.id}/${p.id}`, name: `${equipment.name} · ${p.name}`, signalClass: cls, originEquipmentId: equipment.id, hops: [], listenerIds: [], virtualInputs: [] }
          follow(flow, [{ equipment, portId: p.id, channel: undefined, cls }])
          if (flow.hops.length > 0) flows.push(flow)
        }
      }
    }
  }
  return flows
}

/** The number a channel of a port group has on the device ("Eingang 11" for channel 1 of the XLR
 * inputs after 10 combo ones). */
export function channelNumber(port: Port | undefined, channel: number): number {
  return (port?.firstChannel ?? 1) + channel - 1
}

/** Whether `point` on `ports` still exists (the port, and its channel within the group). */
function pointExists(ports: readonly Port[], portId: string, channel: number | undefined): boolean {
  const p = ports.find((x) => x.id === portId)
  if (!p) return false
  if (channel === undefined) return true
  return p.channels !== undefined && channel <= p.channels
}

/** A setup without the cables and matrix points of `equipmentId` that its new `ports` no longer
 * have - and how many went. */
export function pruneForPorts(setup: StageSetup, equipmentId: string, ports: readonly Port[]): { setup: StageSetup; links: number; crosspoints: number } {
  const endFits = (end: { equipmentId: string; portId: string; channel?: number }) => end.equipmentId !== equipmentId || pointExists(ports, end.portId, end.channel)
  const links = setup.links.filter((l) => endFits(l.from) && endFits(l.to))
  const own = setup.routing[equipmentId]
  const pointFits = (pt: MatrixPoint) => pt.kind === 'virtual' || pointExists(ports, pt.portId, pt.channel)
  const kept = own?.filter((c) => pointFits(c.from) && pointFits(c.to))
  const routing = own ? { ...setup.routing, [equipmentId]: kept! } : setup.routing
  return { setup: { ...setup, links, routing }, links: setup.links.length - links.length, crosspoints: (own?.length ?? 0) - (kept?.length ?? 0) }
}

/**
 * A setup with `fromId`'s place taken by `intoId` (Marco, 2026-11-07: a placeholder tablet linked
 * to the real device, which the map had already added on its own): its cables move over (a cable
 * the placeholder already has stays once), its position and matrix only where the placeholder has
 * none.
 */
export function mergeEquipmentInSetup(setup: StageSetup, fromId: string, intoId: string): StageSetup {
  const swap = (end: PortRef): PortRef => (end.equipmentId === fromId ? { ...end, equipmentId: intoId } : end)
  const key = (l: StageLink) => JSON.stringify([l.from, l.to])
  const links: StageLink[] = []
  for (const l of setup.links.map((x) => ({ ...x, from: swap(x.from), to: swap(x.to) }))) if (!links.some((x) => key(x) === key(l))) links.push(l)
  const { [fromId]: fromPos, ...positions } = setup.positions
  const { [fromId]: fromRouting, ...routing } = setup.routing
  return {
    ...setup,
    links,
    positions: positions[intoId] || !fromPos ? positions : { ...positions, [intoId]: fromPos },
    routing: routing[intoId] || !fromRouting ? routing : { ...routing, [intoId]: fromRouting },
  }
}

/** Links placeholder tablet `placeholder` to registered device `deviceId`: what to save, which
 * equipment the map made for that device on its own (to merge in and remove), or null. */
export function linkPlaceholder(map: StageMap, placeholder: StageEquipment, deviceId: string): { linked: StageEquipment; merge: string | null } {
  const own = map.equipment.find((e) => e.kind === 'stageboard' && e.deviceId === deviceId && e.id !== placeholder.id)
  return { linked: { ...placeholder, deviceId }, merge: own?.id ?? null }
}

/**
 * The desk's numbering over port groups (Marco, 2026-11-07): consecutive groups of the same name and
 * direction count on - "Eingang" 10 combo then "Eingang" 10 XLR are inputs 1-10 and 11-20.
 */
export function numberPorts(ports: readonly Port[]): Port[] {
  const out: Port[] = []
  for (const p of ports) {
    const { firstChannel: _old, ...plain } = p
    const prev = out[out.length - 1]
    if (prev && prev.name === p.name && prev.direction === p.direction) {
      const first = (prev.firstChannel ?? 1) + (prev.channels ?? 1)
      out.push({ ...plain, firstChannel: first })
    } else out.push(plain)
  }
  return out
}

/** What a port carries, chosen by the person - signals follow from it. */
export const PORT_SIGNALS = {
  audio: ['audio'],
  'usb-audio': ['usb-audio', 'midi'],
  midi: ['midi'],
  net: ['net', 'midi'],
  dmx: ['dmx'],
} as const satisfies Record<string, readonly Signal[]>
export type PortSignalKind = keyof typeof PORT_SIGNALS

export function portSignalKind(port: Pick<Port, 'signals'>): PortSignalKind {
  const s = port.signals
  if (s.includes('usb-audio')) return 'usb-audio'
  if (s.includes('net')) return 'net'
  if (s.includes('dmx')) return 'dmx'
  if (s.includes('audio')) return 'audio'
  return 'midi'
}

/** The signal a connector usually carries - the default when one is picked. */
export function defaultSignalKind(connector: Connector): PortSignalKind {
  if (connector === 'usb-a' || connector === 'usb-b' || connector === 'usb-c') return 'usb-audio'
  if (connector === 'din5') return 'midi'
  if (connector === 'ethernet') return 'net'
  if (connector === 'dmx') return 'dmx'
  return 'audio'
}
