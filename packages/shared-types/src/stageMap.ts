import { z } from 'zod'
import { CAPABILITIES, type CapabilityId } from './capability.js'
import { SERVER_EXECUTION_TARGET } from './executionTarget.js'

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
export const SignalSchema = z.enum(['audio', 'usb-audio', 'midi', 'osc', 'dmx', 'net', 'light'])
export type Signal = z.infer<typeof SignalSchema>

/** The signal classes a path runs in (Ton, MIDI, Licht). */
export type SignalClass = 'sound' | 'midi' | 'light'

export const SIGNAL_CLASS: Record<Signal, SignalClass> = {
  audio: 'sound',
  'usb-audio': 'sound',
  midi: 'midi',
  /** Show control for lighting/video software (#484) - a light-class signal over the network. */
  osc: 'light',
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

/**
 * One part of a container port (docs/31 §7b, #739): what a USB or network socket carries, by
 * protocol and direction - "Audio aus · 4", "MIDI ein". A cable always sits on the container; the
 * matrix and the port list unfold it into its parts. `channels` absent: as many as the far end
 * has (a tablet's USB audio has whatever the interface on the cable offers, `partChannels`).
 */
export const PortPartSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  signals: z.array(SignalSchema).min(1),
  direction: PortDirectionSchema,
  channels: z.number().int().min(1).max(128).optional(),
})
export type PortPart = z.infer<typeof PortPartSchema>

/** One physical port. `channels`: a group ("Eingänge 1–16") instead of 16 ports - a cable and a
 * matrix point then name the channel. `pins`: the contacts of one socket (a mono jack 1, a stereo
 * jack or headphone socket 2) - a matrix point may name one ("Klick left, Track right", #742). */
export const PortSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  connector: ConnectorSchema,
  signals: z.array(SignalSchema).min(1),
  direction: PortDirectionSchema,
  channels: z.number().int().min(2).max(128).optional(),
  pins: z.number().int().min(1).max(8).optional(),
  /** Before `pins` (#739): one socket carrying left and right. Read as `pins: 2` (`normalizePort`). */
  stereo: z.boolean().optional(),
  /** The desk's number of channel 1 of this group ("XLR 11–20" after 10 combo inputs) - labels only. */
  firstChannel: z.number().int().min(1).max(256).optional(),
  /** A container's parts (USB, network): protocol → direction → channels. */
  parts: z.array(PortPartSchema).optional(),
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
  z.object({ kind: z.literal('port'), portId: z.string().min(1), channel: z.number().int().positive().optional(), pin: z.number().int().positive().optional() }),
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
  /** Further apps on the same hardware (Marco, 2026-11-07): the Dev app, Chrome, the Stage-Server
   * (`server`) beside `deviceId` - one box, one set of sockets. Joined by hand ("Ist dasselbe Gerät
   * wie …"): no app can tell by itself that another one runs on the same device. */
  appIds: z.array(z.string().min(1)).optional(),
  /** Who this is (kind `person`). */
  listener: ListenerSchema.nullable().default(null),
  /** The member (profile id) this belongs to (#799, docs/31 §0d): own equipment, only offered in
   * that person's own setups. Absent: the band's. */
  owner: z.string().min(1).optional(),
})
export type StageEquipment = z.infer<typeof StageEquipmentSchema>

/** One end of a cable: a port of a piece of equipment, the channel inside a port group, and the
 * pin of a socket where only one is meant (the left of a stereo jack). A cable on a container port
 * names the container, never a part. */
export const PortRefSchema = z.object({
  equipmentId: z.string().min(1),
  portId: z.string().min(1),
  channel: z.number().int().positive().optional(),
  pin: z.number().int().positive().optional(),
})
export type PortRef = z.infer<typeof PortRefSchema>

/** A cable (or radio link) between two ports. `signals`: what it carries - those both ends share.
 * A cable between two two-way ports (USB) carries signals both ways. */
export const StageLinkSchema = z.object({
  id: z.string().min(1),
  from: PortRefSchema,
  to: PortRefSchema,
  signals: z.array(SignalSchema).min(1),
  /** Channels the cable carries (Marco, 2026-11-07): 1 mono, 2 stereo (Aux 1-2 into an in-ear
   * sender's L/R), more for a multicore - from each end's `channel` on. Absent: 1. */
  width: z.number().int().min(1).max(128).optional(),
  /** The MIDI port this cable reaches, by the name the sending app sees it ("Kemper Player") - set
   * by the device's owner when wiring (docs/31 §7, resolved by name as MIDI always was). */
  midiName: z.string().min(1).optional(),
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
  /** The member (profile id) whose own setup this is (#799, docs/31 §0d): for practising at home,
   * never a choice in the Gig, hidden from the other members (the admin sees and edits it).
   * Absent: a setup of the band. */
  owner: z.string().min(1).optional(),
})
export type StageSetup = z.infer<typeof StageSetupSchema>

export const StageMapSchema = z.object({
  equipment: z.array(StageEquipmentSchema),
  setups: z.array(StageSetupSchema).min(1),
})
export type StageMap = z.infer<typeof StageMapSchema>

const port = (id: string, name: string, connector: Connector, signals: Signal[], direction: PortDirection, channels?: number): Port =>
  channels === undefined ? { id, name, connector, signals, direction } : { id, name, connector, signals, direction, channels }

/** A single socket carrying left and right. */
const stereo = (p: Port): Port => ({ ...p, pins: 2 })

/** A container port with its parts (docs/31 §7b). */
const container = (p: Port, parts: PortPart[]): Port => ({ ...p, parts })
const part = (id: string, name: string, signals: Signal[], direction: PortDirection, channels?: number): PortPart =>
  channels === undefined ? { id, name, signals, direction } : { id, name, signals, direction, channels }

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
      stereo(port('headphones', 'Kopfhörer', 'jack-3.5', ['audio'], 'out')),
      // Over USB (docs/31 §7b): audio to the interface (as many channels as it has), audio from it,
      // MIDI both ways - one cable, one container.
      container(port('usb', 'USB-C', 'usb-c', ['usb-audio', 'midi'], 'both'), [
        part('usb/audio-out', 'Audio aus', ['usb-audio'], 'out'),
        part('usb/audio-in', 'Audio ein', ['usb-audio'], 'in'),
        part('usb/midi-out', 'MIDI aus', ['midi'], 'out'),
        part('usb/midi-in', 'MIDI ein', ['midi'], 'in'),
      ]),
      stereo(port('bluetooth', 'Bluetooth', 'wireless', ['audio'], 'out')),
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
    [port('in', 'Eingang', 'xlr-jack', ['audio'], 'in', 16), port('main', 'Main L/R', 'xlr', ['audio'], 'out', 2), port('aux', 'Aux', 'xlr-jack', ['audio'], 'out', 4)],
    free(),
  ),
  builtin(
    'audio-interface',
    'Audio-Interface',
    'audio-interface',
    // Playback from the host lands on the outputs 1:1; what the host records is "Audio aus".
    [
      container(port('usb', 'USB', 'usb-b', ['usb-audio', 'midi'], 'both'), [
        part('usb/audio-in', 'Audio ein (vom Host)', ['usb-audio'], 'in', 2),
        part('usb/audio-out', 'Audio aus (zum Host)', ['usb-audio'], 'out', 2),
        part('usb/midi-in', 'MIDI ein', ['midi'], 'in'),
        part('usb/midi-out', 'MIDI aus', ['midi'], 'out'),
      ]),
      port('out', 'Ausgang', 'jack-6.3', ['audio'], 'out', 2),
    ],
    free(via(at('usb/audio-in', 1), at('out', 1)), via(at('usb/audio-in', 2), at('out', 2))),
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
  // Two mono inputs (L/R): one channel for a mono mix, both for stereo (Marco, 2026-11-07).
  builtin(
    'iem-sender',
    'In-Ear-Sender',
    'iem-sender',
    [port('in', 'Eingang', 'xlr-jack', ['audio'], 'in', 2), stereo(port('out', 'Funk', 'wireless', ['audio'], 'out'))],
    fixed(via(at('in', 1), at('out')), via(at('in', 2), at('out'))),
  ),
  // The beltpack (Marco, 2026-11-07): the radio link from the sender shows as its own line, then the
  // earphones to the person.
  builtin('iem-receiver', 'In-Ear-Empfänger', 'iem-receiver', [port('in', 'Funk', 'wireless', ['audio'], 'in'), stereo(port('phones', 'Ohrhörer', 'jack-3.5', ['audio'], 'out'))], fixed(via(at('in'), at('phones')))),
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
type PortLike = { direction: PortDirection; signals: readonly Signal[]; connector: Connector }

export function portFit(from: PortLike, to: PortLike): PortFit | null {
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

/** Every app on a box: its device, the further ones on the same hardware, and the Stage-Server when
 * that box is the server itself. */
export function appsOf(e: StageEquipment): string[] {
  return [...(e.deviceId ? [e.deviceId] : []), ...(e.kind === 'stage-server' ? [SERVER_EXECUTION_TARGET] : []), ...(e.appIds ?? [])]
}

/**
 * "Ist dasselbe Gerät wie …" (2026-11-07): box `merge` (an app the map put in a box of its own -
 * the Dev app beside the release app, the Stage-Server beside Chrome on the laptop) goes into
 * `keep`: its apps join, its cables, place and matrix move over where `keep` has none
 * (mergeEquipmentInSetup), and it is removed.
 */
export function joinDevices(keep: StageEquipment, merge: StageEquipment): StageEquipment {
  const apps = [...new Set([...appsOf(keep), ...appsOf(merge)])].filter((id) => id !== keep.deviceId)
  return { ...keep, appIds: apps }
}

/** An app taken out of a box again - the map gives it a box of its own as for any new device. */
export function separateApp(box: StageEquipment, appId: string): StageEquipment {
  return { ...box, appIds: (box.appIds ?? []).filter((id) => id !== appId) }
}
export const signedInListenerId = (deviceId: string): string => `listener:${deviceId}`
export const defaultLinkId = (deviceId: string): string => `default:${deviceId}`

/**
 * Adds a StageBoard device the default way (decision 6): the device - its matrix routes Klick,
 * Track and Ansagen to its speaker -, whoever is signed in on it, and the speaker to them, in
 * every setup. Unchanged when the device is on the map already (the band may have changed it).
 */
export function addDeviceToMap(map: StageMap, device: { id: string; name: string }): StageMap {
  const equipmentId = deviceEquipmentId(device.id)
  if (map.equipment.some((e) => e.id === equipmentId || appsOf(e).includes(device.id))) return map
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
  /** Channels the signal has: 2 for the track, 1 for the click (absent: 1). The signal library
   * (#740) makes this a property of the signal; until then `virtualPortWidth`. */
  width?: number
}

/** How many channels a virtual port carries: the track is stereo, everything else mono (#744;
 * a property of the signal once the signal library #740 exists). */
export function virtualPortWidth(capability: CapabilityId): number {
  return capability === CAPABILITIES.audioPlayback ? 2 : 1
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

/** Whether a matrix point names where a signal arrived: the port (or, from before parts, its
 * container), and its channel and pin where both sides name one. */
const pointMatches = (point: MatrixPoint, ports: readonly Port[], portId: string, channel: number | undefined, pin: number | undefined): boolean =>
  point.kind === 'port' &&
  (point.portId === portId || point.portId === cablePortId(ports, portId)) &&
  (point.channel === undefined || channel === undefined || point.channel === channel) &&
  (point.pin === undefined || pin === undefined || point.pin === pin)

/** The class a signal has on `port`, or null when the port cannot carry it. Gear that sounds
 * turns MIDI into sound. */
function classOn(port: { signals: readonly Signal[] }, cls: SignalClass, sounds: boolean): SignalClass | null {
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
  // A cable `width` channels wide carries channel `mine.channel + k` to `theirs.channel + k`.
  const cablesOut = (equipment: StageEquipment, portId: string, channel: number | undefined, pin: number | undefined, cls: SignalClass) => {
    const out: { link: StageLink; from: PortRef; to: PortRef }[] = []
    const myPort = lookupPort(equipment.ports, portId)
    if (!myPort || myPort.direction === 'in') return out
    // A cable sits on the container of a part (docs/31 §7b).
    const attach = myPort.container?.id ?? portId
    for (const link of setup.links) {
      if (!link.signals.some((s) => SIGNAL_CLASS[s] === cls)) continue
      const width = link.width ?? 1
      for (const [mine, theirs] of [
        [link.from, link.to],
        [link.to, link.from],
      ] as const) {
        if (mine.equipmentId !== equipment.id || mine.portId !== attach) continue
        if (channel !== undefined && mine.channel !== undefined && (channel < mine.channel || channel >= mine.channel + width)) continue
        const other = byId.get(theirs.equipmentId)
        const theirPort = other?.ports.find((p) => p.id === theirs.portId)
        if (!theirPort || theirPort.direction === 'out') continue
        if (myPort.container) {
          // Container to container: the far part that takes this class, channel for channel.
          const farPart = theirPort.parts?.find((x) => x.direction !== 'out' && classOn(x, cls, false))
          if (theirPort.parts && !farPart) continue
          const to: PortRef = farPart ? { equipmentId: theirs.equipmentId, portId: farPart.id, ...(channel === undefined ? {} : { channel }) } : theirs
          out.push({ link, from: { ...mine, portId, ...(channel === undefined ? {} : { channel }) }, to })
          continue
        }
        const from: PortRef = { ...mine, ...(channel === undefined ? {} : { channel }), ...(pin === undefined ? {} : { pin }) }
        if (theirs.channel === undefined) {
          // Onto one socket: a pin of a stereo jack lands on the same pin of a stereo socket.
          out.push({ link, from, to: pin !== undefined && (theirPort.pins ?? 1) > 1 ? { ...theirs, pin } : theirs })
        } else if (channel !== undefined && mine.channel !== undefined) out.push({ link, from, to: { ...theirs, channel: theirs.channel + channel - mine.channel } })
        // One pin of a stereo jack onto a group: the left on the first channel, the right on the next.
        else if (pin !== undefined) out.push({ link, from, to: { ...theirs, channel: theirs.channel + pin - 1 } })
        // The whole port (a stereo jack) onto a group: every channel the cable is wide.
        else for (let k = 0; k < width; k++) out.push({ link, from, to: { ...theirs, channel: theirs.channel + k } })
      }
    }
    return out
  }

  const follow = (flow: SignalFlow, start: { equipment: StageEquipment; portId: string; channel: number | undefined; pin: number | undefined; cls: SignalClass }[]) => {
    const queue = [...start]
    const seen = new Set<string>()
    while (queue.length > 0) {
      const { equipment, portId, channel, pin, cls } = queue.shift()!
      for (const cable of cablesOut(equipment, portId, channel, pin, cls)) {
        const visit = `${cable.link.id}>${cable.to.equipmentId}/${cable.to.portId}#${cable.to.channel ?? ''}.${cable.to.pin ?? ''}:${cls}`
        if (seen.has(visit)) continue
        seen.add(visit)
        const target = byId.get(cable.to.equipmentId)
        const inPort = target ? lookupPort(target.ports, cable.to.portId) : undefined
        if (!target || !inPort || !classOn(inPort, cls, false)) continue
        flow.hops.push({ linkId: cable.link.id, from: cable.from, to: cable.to })
        if (LISTENER_KINDS.includes(target.kind)) {
          if (!flow.listenerIds.includes(target.id)) flow.listenerIds.push(target.id)
          continue
        }
        const inChannel = cable.to.channel
        for (const cross of effectiveRouting(target, setup)) {
          if (!pointMatches(cross.from, target.ports, cable.to.portId, inChannel, cable.to.pin)) continue
          if (cross.to.kind === 'virtual') {
            if (DRIVER_KINDS.includes(target.kind)) flow.virtualInputs.push({ equipmentId: target.id, virtualPortId: cross.to.virtualPortId })
            continue
          }
          const outPort = lookupPort(target.ports, cross.to.portId)
          const nextCls = outPort ? classOn(outPort, cls, target.sounds) : null
          if (!outPort || !nextCls) continue
          queue.push({ equipment: target, portId: outPort.id, channel: cross.to.channel ?? (outPort.channels ? undefined : inChannel), pin: cross.to.pin, cls: nextCls })
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
            const to = c.to as { portId: string; channel?: number; pin?: number }
            const p = lookupPort(equipment.ports, to.portId)
            return p && classOn(p, cls, false) ? [{ equipment, portId: p.id, channel: to.channel, pin: to.pin, cls }] : []
          })
        follow(flow, starts)
        flows.push(flow)
      }
    } else if (!equipment.ports.some((p) => p.direction === 'in')) {
      // A source of its own (a pedal): each output sends what it carries.
      for (const p of equipment.ports) {
        for (const cls of [...new Set(p.signals.map((s) => SIGNAL_CLASS[s]))]) {
          const flow: SignalFlow = { key: `${equipment.id}/${p.id}`, name: `${equipment.name} · ${p.name}`, signalClass: cls, originEquipmentId: equipment.id, hops: [], listenerIds: [], virtualInputs: [] }
          follow(flow, [{ equipment, portId: p.id, channel: undefined, pin: undefined, cls }])
          if (flow.hops.length > 0) flows.push(flow)
        }
      }
    }
  }
  return flows
}

/** The number a channel of a port group has on the device ("Eingang 11" for channel 1 of the XLR
 * inputs after 10 combo ones). */
export function channelNumber(port: Pick<Port, 'firstChannel'> | undefined, channel: number): number {
  return (port?.firstChannel ?? 1) + channel - 1
}

/** Whether `point` on `ports` still exists (the port or part, its channel within the group, its pin). */
function pointExists(ports: readonly Port[], portId: string, channel: number | undefined, pin: number | undefined): boolean {
  const p = lookupPort(ports, portId)
  if (!p) return false
  if (channel !== undefined && (p.channels === undefined || channel > p.channels)) return false
  return pin === undefined || pin <= (p.pins ?? 1)
}

/** A setup without the cables and matrix points of `equipmentId` that its new `ports` no longer
 * have - and how many went. */
export function pruneForPorts(setup: StageSetup, equipmentId: string, ports: readonly Port[]): { setup: StageSetup; links: number; crosspoints: number } {
  const endFits = (end: PortRef) => end.equipmentId !== equipmentId || pointExists(ports, end.portId, end.channel, end.pin)
  const links = setup.links.filter((l) => endFits(l.from) && endFits(l.to))
  const own = setup.routing[equipmentId]
  const pointFits = (pt: MatrixPoint) => pt.kind === 'virtual' || pointExists(ports, pt.portId, pt.channel, pt.pin)
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
  const own = map.equipment.find((e) => e.kind === 'stageboard' && appsOf(e).includes(deviceId) && e.id !== placeholder.id)
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
  net: ['net', 'midi', 'osc'],
  osc: ['osc'],
  dmx: ['dmx'],
} as const satisfies Record<string, readonly Signal[]>
export type PortSignalKind = keyof typeof PORT_SIGNALS

export function portSignalKind(port: Pick<Port, 'signals'>): PortSignalKind {
  const s = port.signals
  if (s.includes('usb-audio')) return 'usb-audio'
  if (s.includes('net')) return 'net'
  if (s.includes('osc')) return 'osc'
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

/** The mono slots of a port in order - socket by socket, pin by pin: a group of 4 mono jacks has
 * 4, a stereo jack 2 (its pins), a headphone amp with 4 stereo sockets 8. */
export function portSlots(port: Pick<PortView, 'channels' | 'pins'>): { channel?: number; pin?: number }[] {
  const sockets = port.channels ?? 1
  const pins = port.pins ?? 1
  const out: { channel?: number; pin?: number }[] = []
  for (let c = 1; c <= sockets; c++) for (let p = 1; p <= pins; p++) out.push({ ...(port.channels ? { channel: c } : {}), ...(pins > 1 ? { pin: p } : {}) })
  return out
}

/** Where a cable end starts among a port's slots: its channel and pin, the first of each when unnamed. */
function slotIndex(port: Pick<PortView, 'channels' | 'pins'>, channel: number | undefined, pin: number | undefined): number {
  const i = portSlots(port).findIndex((s) => (s.channel ?? 1) === (channel ?? 1) && (s.pin ?? 1) === (pin ?? 1))
  return i < 0 ? 0 : i
}

/** Channels a port takes from its `channel` (and `pin`) on: the rest of its group, or the rest of
 * a stereo socket's pins. */
export function portCapacity(port: Pick<PortView, 'channels' | 'pins'>, channel: number | undefined, pin?: number): number {
  return portSlots(port).length - slotIndex(port, channel, pin)
}

/** Soft connectors share freely - a radio link or a speaker reaches many. */
const SHARED_CONNECTORS: readonly Connector[] = ['wireless', 'room', 'builtin', 'ear', 'eye']

export type StageIssue =
  | { kind: 'double'; equipmentId: string; portId: string; channel: number | undefined; pin?: number; linkIds: string[] }
  | { kind: 'width'; linkId: string; equipmentId: string; portId: string; width: number; capacity: number }
  | { kind: 'mono-of-stereo'; linkId: string; equipmentId: string; portId: string }
  | { kind: 'adapter'; linkId: string }

export interface PortUse {
  equipmentId: string
  portId: string
  name: string
  direction: PortDirection
  used: number
  total: number
}

/** The slots a cable end occupies: `width` of them from where it starts - the whole socket when it
 * is a single mono one. */
function occupied(end: PortRef, width: number, port: PortView): { channel?: number; pin?: number }[] {
  const slots = portSlots(port)
  if (end.channel === undefined && end.pin === undefined && slots.length === 1) return [{}]
  const start = slotIndex(port, end.channel, end.pin)
  // A stereo cable onto a whole stereo socket takes both pins; onto a group, `width` sockets.
  return slots.slice(start, start + Math.max(1, width))
}
const slotKey = (s: { channel?: number; pin?: number }) => `${s.channel ?? ''}.${s.pin ?? ''}`

/**
 * The checks for technicians (Marco, 2026-11-07): a socket or channel with two cables (a real plug
 * takes one - radio and sound are shared), a cable wider than where it lands (stereo into one mono
 * input), only one side of a stereo socket taken, plugs that need an adapter - and per port how many
 * channels are in use.
 */
export function checkSetup(map: StageMap, setupId: string): { issues: StageIssue[]; use: PortUse[] } {
  const setup = map.setups.find((s) => s.id === setupId)
  if (!setup) return { issues: [], use: [] }
  const byId = new Map(map.equipment.map((e) => [e.id, e]))
  const issues: StageIssue[] = []
  const taken = new Map<string, string[]>()
  for (const link of setup.links) {
    const width = link.width ?? 1
    const ends = [link.from, link.to].map((end) => ({ end, port: lookupPort(byId.get(end.equipmentId)?.ports ?? [], end.portId) }))
    for (const { end, port } of ends) {
      if (!port) continue
      // A container carries every part at once - channels are counted on the parts, not the cable;
      // radio and sound carry the whole signal, nothing to count there either.
      if (port.parts || SHARED_CONNECTORS.includes(port.connector)) continue
      const capacity = portCapacity(port, end.channel, end.pin)
      if (width > capacity) issues.push({ kind: 'width', linkId: link.id, equipmentId: end.equipmentId, portId: end.portId, width, capacity })
      else if (width === 1 && (port.pins ?? 1) > 1 && end.pin === undefined && port.channels === undefined) issues.push({ kind: 'mono-of-stereo', linkId: link.id, equipmentId: end.equipmentId, portId: end.portId })
      for (const slot of occupied(end, width, port)) {
        const key = `${end.equipmentId}|${end.portId}|${slotKey(slot)}`
        taken.set(key, [...(taken.get(key) ?? []), link.id])
      }
    }
    const [a, b] = ends
    if (a!.port && b!.port) {
      const fit = portFit(a!.port, b!.port) ?? portFit(b!.port, a!.port)
      if (fit?.adapter) issues.push({ kind: 'adapter', linkId: link.id })
    }
  }
  for (const [key, linkIds] of taken) {
    if (linkIds.length < 2) continue
    const [equipmentId, portId, slot] = key.split('|') as [string, string, string]
    const [ch, pin] = slot.split('.') as [string, string]
    issues.push({ kind: 'double', equipmentId, portId, channel: ch === '' ? undefined : Number(ch), ...(pin === '' ? {} : { pin: Number(pin) }), linkIds })
  }
  const use: PortUse[] = []
  for (const e of map.equipment) {
    if (!setup.positions[e.id]) continue
    for (const p of e.ports) {
      if (SHARED_CONNECTORS.includes(p.connector) || p.parts) continue
      const total = p.channels ?? 1
      const usedSockets = new Set([...taken.keys()].filter((k) => k.startsWith(`${e.id}|${p.id}|`)).map((k) => k.split('|')[2]!.split('.')[0])).size
      use.push({ equipmentId: e.id, portId: p.id, name: p.name, direction: p.direction, used: Math.min(usedSockets, total), total })
    }
  }
  return { issues, use }
}

export interface WiringCable {
  /** Number on the list - one per physical cable. */
  number: number
  linkId: string
  from: PortRef
  to: PortRef
  fromConnector: Connector
  toConnector: Connector
  adapter: boolean
  /** One stereo socket split onto two channels (or two joined): a Y cable. */
  y: boolean
}

/**
 * The wiring list of a setup (Marco, 2026-11-07): every physical cable (no radio, no speaker to an
 * ear), numbered - a stereo line
 * between two groups is two cables (L and R), a stereo jack onto two channels one Y cable.
 */
export function wiringList(map: StageMap, setupId: string): WiringCable[] {
  const setup = map.setups.find((s) => s.id === setupId)
  if (!setup) return []
  const byId = new Map(map.equipment.map((e) => [e.id, e]))
  const name = (id: string) => byId.get(id)?.name ?? id
  const links = [...setup.links].sort((a, b) => name(a.from.equipmentId).localeCompare(name(b.from.equipmentId)) || a.from.portId.localeCompare(b.from.portId) || (a.from.channel ?? 0) - (b.from.channel ?? 0))
  const out: WiringCable[] = []
  for (const link of links) {
    const fromPort = lookupPort(byId.get(link.from.equipmentId)?.ports ?? [], link.from.portId)
    const toPort = lookupPort(byId.get(link.to.equipmentId)?.ports ?? [], link.to.portId)
    if (!fromPort || !toPort) continue
    // Radio, a speaker to the ears: no cable to lay.
    if (SHARED_CONNECTORS.includes(fromPort.connector) || SHARED_CONNECTORS.includes(toPort.connector)) continue
    const fit = portFit(fromPort, toPort) ?? portFit(toPort, fromPort)
    const base = { linkId: link.id, fromConnector: fromPort.connector, toConnector: toPort.connector, adapter: fit?.adapter ?? false }
    const width = link.width ?? 1
    const split = (end: PortRef, port: PortView) => end.channel !== undefined || port.channels !== undefined
    if (width > 1 && split(link.from, fromPort) && split(link.to, toPort)) {
      for (let k = 0; k < width; k++) {
        const at = (end: PortRef): PortRef => ({ ...end, channel: (end.channel ?? 1) + k })
        out.push({ ...base, number: out.length + 1, from: at(link.from), to: at(link.to), y: false })
      }
    } else out.push({ ...base, number: out.length + 1, from: link.from, to: link.to, y: width > 1 && split(link.from, fromPort) !== split(link.to, toPort) })
  }
  return out
}

/** The setup a band plays by, until the Gig chooses one (docs/31 §6 step 5): "Standard", else the first. */
export function activeSetup(map: StageMap): StageSetup | null {
  return map.setups.find((s) => s.id === DEFAULT_SETUP_ID) ?? map.setups[0] ?? null
}

/**
 * The own setups a member gets to see (#799, docs/31 §0d): their own; the admin everybody's.
 */
export function visibleOwnSetups(setups: readonly StageSetup[], profileId: string, isAdmin: boolean): StageSetup[] {
  return setups.filter((s) => s.owner !== undefined && (isAdmin || (profileId !== '' && s.owner === profileId)))
}

/** The equipment a setup may place (#799): the band's, in an own setup also its owner's. */
export function equipmentOffered(equipment: readonly StageEquipment[], setup: Pick<StageSetup, 'owner'> | null | undefined): StageEquipment[] {
  return equipment.filter((e) => e.owner === undefined || (setup?.owner !== undefined && e.owner === setup.owner))
}

/**
 * A new own setup started from a band setup (#799): the member's own devices as they stand there,
 * with the listeners that hang directly on them (the headphones into the ears) - everything else
 * is placed by hand.
 */
export function ownSetupFrom(map: StageMap, from: StageSetup, owner: string, ownEquipmentIds: readonly string[], id: string, name: string): StageSetup {
  const keep = new Set(ownEquipmentIds.filter((e) => from.positions[e]))
  const person = (e: string) => map.equipment.find((x) => x.id === e)?.kind === 'person'
  for (const l of from.links) {
    if (keep.has(l.from.equipmentId) && person(l.to.equipmentId)) keep.add(l.to.equipmentId)
    if (keep.has(l.to.equipmentId) && person(l.from.equipmentId)) keep.add(l.from.equipmentId)
  }
  const pick = <T,>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([e]) => keep.has(e)))
  return { id, name, owner, positions: pick(from.positions), links: from.links.filter((l) => keep.has(l.from.equipmentId) && keep.has(l.to.equipmentId)), routing: pick(from.routing) }
}

/** Which side of a stereo output a signal sits on. */
export type OutputSide = 'both' | 'left' | 'right'

/**
 * The Android output a port stands for (`AudioRoute`), `any` while the band has not ticked this
 * device's matrix (the default map: wherever Android plays, as before #742), `none` for a point
 * this stage cannot play (a channel above 2 - several channels are #743 - or a plug that is no
 * audio output of the device).
 */
export type OutputRouteKind = 'speaker' | 'wired' | 'usb' | 'bluetooth' | 'any' | 'none'

export interface MapOutput {
  portId: string
  route: OutputRouteKind
  side: OutputSide
}

function routeOfConnector(connector: Connector): OutputRouteKind {
  if (connector === 'builtin') return 'speaker'
  if (connector === 'jack-3.5' || connector === 'jack-6.3' || connector === 'jack-6.3-ts') return 'wired'
  if (connector === 'wireless') return 'bluetooth'
  if (connector === 'usb-a' || connector === 'usb-b' || connector === 'usb-c') return 'usb'
  return 'none'
}

/** The setup with this id, else the active one. */
function setupOf(map: StageMap, setupId?: string): StageSetup | null {
  return (setupId !== undefined ? map.setups.find((s) => s.id === setupId) : undefined) ?? activeSetup(map)
}

/**
 * Where a StageBoard app plays a built-in output (Klick, Track, Ansagen) - the sound follows the
 * map (docs/31 §0d, §7c, #742): every point its device's matrix routes the virtual output to, as
 * Android output and side (pin or channel 1 = left, 2 = right, the whole socket = both). Empty:
 * the app plays nothing - its device is not placed in the setup, routes the output nowhere, or
 * another app on the device is in front (`frontApp`: box id → app). Null without a map - the old
 * rules (roles, the master) still apply then. `setupId`: a setup other than the active one
 * (practising "as in setup …").
 */
export function mapOutputs(map: StageMap, deviceId: string, capability: CapabilityId, frontApp: Readonly<Record<string, string>> = {}, setupId?: string): MapOutput[] | null {
  const setup = setupOf(map, setupId)
  if (!setup) return null
  const device = map.equipment.find((e) => e.kind === 'stageboard' && appsOf(e).includes(deviceId))
  if (!device || !setup.positions[device.id]) return []
  // Several apps on one device: only the one that came to the front last plays - no double click.
  const front = frontApp[device.id]
  if (front && front !== deviceId && appsOf(device).includes(front)) return []
  const ids = new Set(DEFAULT_VIRTUAL_OUTPUTS.filter((v) => v.capability === capability).map((v) => v.id))
  // Not ticked by the band yet: the model's default routing, played wherever Android plays.
  const untouched = device.routing?.mode !== 'fixed' && setup.routing[device.id] === undefined
  const out: MapOutput[] = []
  for (const c of effectiveRouting(device, setup)) {
    if (c.from.kind !== 'virtual' || !ids.has(c.from.virtualPortId) || c.to.kind !== 'port') continue
    const port = lookupPort(device.ports, c.to.portId)
    const index = c.to.pin ?? c.to.channel
    const side: OutputSide = index === undefined ? 'both' : index === 1 ? 'left' : 'right'
    const playable = port !== undefined && (index === undefined || index <= 2)
    out.push({ portId: c.to.portId, route: untouched ? 'any' : playable ? routeOfConnector(port.connector) : 'none', side })
  }
  return out
}

/**
 * Whether a StageBoard app plays a built-in output in the Gig - the map decides (docs/31 §6
 * step 2, Marco 2026-11-07): `mapOutputs` names at least one point. Null without a map.
 */
export function mapPlays(map: StageMap, deviceId: string, capability: CapabilityId, frontApp: Readonly<Record<string, string>> = {}): boolean | null {
  const outputs = mapOutputs(map, deviceId, capability, frontApp)
  return outputs === null ? null : outputs.length > 0
}

/**
 * The side a source plays on while Android is on `route`, from its `mapOutputs`: the points on
 * that output together (left and right = both). Null: none of its points is on that output - the
 * source stays silent, never played somewhere else (docs/28). A browser cannot tell the route
 * (`unknown`): every playable point counts there.
 */
export function outputSide(outputs: readonly MapOutput[], route: string): OutputSide | null {
  const here = outputs.filter((o) => o.route === 'any' || (o.route !== 'none' && (route === 'unknown' || o.route === route)))
  if (here.length === 0) return null
  if (here.some((o) => o.side === 'both')) return 'both'
  return here.every((o) => o.side === here[0]!.side) ? here[0]!.side : 'both'
}

/** Klick, Track and Ansagen - decided by mapPlays, not by mapRoute. */
export const BUILT_IN_OUTPUT_CAPABILITIES: readonly CapabilityId[] = DEFAULT_VIRTUAL_OUTPUTS.map((v) => v.capability)

/**
 * Where the map sends a virtual port (a Logical Device - "Kemper") in the active setup (docs/31 §6
 * step 2, part 2, 2026-11-07): the app that executes it - the device whose matrix routes it to one
 * of its ports, the one in front of several apps there, or the Stage-Server - and the MIDI port
 * name on the cable from that port, if one is set. `app: null`: the map routes it nowhere, nobody
 * sends. Null without a map - the old binding applies.
 */
export function mapRoute(map: StageMap, virtualPortId: string, frontApp: Readonly<Record<string, string>> = {}): { app: string | null; midiName: string | null } | null {
  const setup = activeSetup(map)
  if (!setup) return null
  for (const box of map.equipment) {
    if ((box.kind !== 'stageboard' && box.kind !== 'stage-server') || !setup.positions[box.id]) continue
    // An output ("Kemper") is routed onto a port; an input ("Pedal") from one.
    const routing = effectiveRouting(box, setup)
    const out = routing.find((c) => c.from.kind === 'virtual' && c.from.virtualPortId === virtualPortId && c.to.kind === 'port')
    const inp = routing.find((c) => c.to.kind === 'virtual' && c.to.virtualPortId === virtualPortId && c.from.kind === 'port')
    const point = out?.to ?? inp?.from
    if (!point || point.kind !== 'port') continue
    // The cable sits on the container of a part (docs/31 §7b).
    const portId = cablePortId(box.ports, point.portId)
    const apps = appsOf(box)
    const app = box.kind === 'stage-server' ? SERVER_EXECUTION_TARGET : frontApp[box.id] && apps.includes(frontApp[box.id]!) ? frontApp[box.id]! : (box.deviceId ?? apps[0] ?? null)
    const cable = setup.links.find((l) => (l.from.equipmentId === box.id && l.from.portId === portId) || (l.to.equipmentId === box.id && l.to.portId === portId))
    return { app, midiName: cable?.midiName ?? null }
  }
  return { app: null, midiName: null }
}

/** The Logical Devices as the map says: every one but Klick/Track/Ansagen executes where mapRoute
 * sends it. Without a map, as stored. */
export function routedLogicalDevices<T extends { id: string; capability: string; executionTarget: string | null }>(devices: readonly T[], map: StageMap, frontApp: Readonly<Record<string, string>> = {}): T[] {
  if (!activeSetup(map)) return [...devices]
  return devices.map((d) => {
    if (BUILT_IN_OUTPUT_CAPABILITIES.includes(d.capability as CapabilityId)) return d
    const route = mapRoute(map, d.id, frontApp)
    return route ? { ...d, executionTarget: route.app } : d
  })
}

/**
 * A port, or a part of a container port, seen through one shape (docs/31 §7b): a part's signals,
 * direction and channels with its container's plug and name in front. `container`: the port a
 * cable sits on when this is a part.
 */
export interface PortView {
  id: string
  name: string
  connector: Connector
  signals: readonly Signal[]
  direction: PortDirection
  channels: number | undefined
  pins: number | undefined
  parts: readonly PortPart[] | undefined
  /** The desk's number of channel 1 (`Port.firstChannel`) - a part has none. */
  firstChannel: number | undefined
  container: Port | null
}

export function lookupPort(ports: readonly Port[], id: string): PortView | undefined {
  for (const p of ports) {
    if (p.id === id) return { id: p.id, name: p.name, connector: p.connector, signals: p.signals, direction: p.direction, channels: p.channels, pins: p.pins ?? (p.stereo ? 2 : undefined), parts: p.parts, firstChannel: p.firstChannel, container: null }
    const part = p.parts?.find((x) => x.id === id)
    if (part) return { id: part.id, name: `${p.name} · ${part.name}`, connector: p.connector, signals: part.signals, direction: part.direction, channels: part.channels, pins: undefined, parts: undefined, firstChannel: undefined, container: p }
  }
  return undefined
}

/** The port a cable sits on for `id`: the container of a part, else `id` itself. */
export function cablePortId(ports: readonly Port[], id: string): string {
  return lookupPort(ports, id)?.container?.id ?? id
}

/** Plugs whose socket is a container of protocols (docs/31 §7b). */
const CONTAINER_CONNECTORS: readonly Connector[] = ['usb-a', 'usb-b', 'usb-c', 'ethernet']

/**
 * The parts a container port has by what it carries, when none were written: audio to and from
 * the far end, MIDI both ways, network/OSC as one. Channel counts stay open - the far end tells
 * (`partChannels`).
 */
export function defaultParts(port: Port): PortPart[] | undefined {
  if (!CONTAINER_CONNECTORS.includes(port.connector) || port.parts) return undefined
  const out: PortPart[] = []
  const can = (d: PortDirection) => port.direction === 'both' || port.direction === d
  const add = (suffix: string, name: string, signals: Signal[], direction: PortDirection) => {
    if (can(direction)) out.push({ id: `${port.id}/${suffix}`, name, signals, direction })
  }
  if (port.signals.includes('usb-audio') || port.signals.includes('audio')) {
    add('audio-out', 'Audio aus', ['usb-audio'], 'out')
    add('audio-in', 'Audio ein', ['usb-audio'], 'in')
  }
  if (port.signals.includes('midi')) {
    add('midi-out', 'MIDI aus', ['midi'], 'out')
    add('midi-in', 'MIDI ein', ['midi'], 'in')
  }
  if (port.signals.includes('net')) add('net', 'Netzwerk', ['net'], port.direction)
  if (port.signals.includes('osc')) add('osc', 'OSC', ['osc'], port.direction)
  if (port.signals.includes('dmx')) add('dmx', 'DMX', ['dmx'], port.direction)
  return out.length > 0 ? out : undefined
}

/** A port as written before #739 read the new way: `stereo` becomes `pins: 2`, a USB or network
 * socket without parts gets its default parts. Cables and matrix points on it stay valid - a point
 * on the container still means "all of it". */
export function normalizePort(port: Port): Port {
  const { stereo, ...rest } = port
  const pins = port.pins ?? (stereo ? 2 : undefined)
  const parts = port.parts ?? defaultParts(port)
  return { ...rest, ...(pins === undefined ? {} : { pins }), ...(parts === undefined ? {} : { parts }) }
}

/** Equipment from the database read the new way (#739) - no write, the band's documents stay as they are. */
export function normalizeEquipment(equipment: StageEquipment): StageEquipment {
  return { ...equipment, ports: equipment.ports.map(normalizePort) }
}

/**
 * How many channels a part has in `setup`: its own count, else what the far end of the cable on
 * its container offers for the same class the other way round (a tablet's "Audio aus" has as many
 * channels as the interface's "Audio ein"). Undefined: nothing on the cable says.
 */
export function partChannels(map: StageMap, setup: StageSetup, equipmentId: string, partId: string): number | undefined {
  const equipment = map.equipment.find((e) => e.id === equipmentId)
  const view = equipment ? lookupPort(equipment.ports, partId) : undefined
  if (!view) return undefined
  if (view.channels !== undefined || !view.container) return view.channels
  const classes = new Set(view.signals.map((s) => SIGNAL_CLASS[s]))
  for (const link of setup.links) {
    for (const [mine, theirs] of [
      [link.from, link.to],
      [link.to, link.from],
    ] as const) {
      if (mine.equipmentId !== equipmentId || mine.portId !== view.container.id) continue
      const far = map.equipment.find((e) => e.id === theirs.equipmentId)?.ports.find((p) => p.id === theirs.portId)
      const farPart = far?.parts?.find((x) => x.direction !== view.direction && x.signals.some((sig) => classes.has(SIGNAL_CLASS[sig])))
      if (farPart?.channels !== undefined) return farPart.channels
    }
  }
  return undefined
}
