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

/** How a device is powered (#748, Marco 2026-11-10: no phases): on an earthed socket, on a plug
 * without earth (a wall wart, a two-pin charger), or on its battery. Only earthed devices can close
 * a hum loop. */
export const EarthSchema = z.enum(['earthed', 'floating', 'battery'])
export type Earth = z.infer<typeof EarthSchema>

/** Where a path ends: whoever hears or sees it. */
export const LISTENER_KINDS: readonly EquipmentKind[] = ['person', 'hall']
/** StageBoard itself: its matrix has the virtual ports. */
export const DRIVER_KINDS: readonly EquipmentKind[] = ['stageboard', 'stage-server']

/** One row or column of a routing matrix: a physical port (one channel of a group), or a virtual
 * port of StageBoard (a Logical Device id) on a StageBoard device - for a stereo one (the track)
 * `channel` 1 or 2 names its left or right side alone ("Track L"), without it the whole signal. */
export const MatrixPointSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('port'), portId: z.string().min(1), channel: z.number().int().positive().optional(), pin: z.number().int().positive().optional() }),
  z.object({ kind: z.literal('virtual'), virtualPortId: z.string().min(1), channel: z.number().int().min(1).max(2).optional() }),
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
  /** Whether the gear mixes several signals routed onto one output (#746) - absent: by its kind
   * (`equipmentMixes`). */
  mixes: z.boolean().optional(),
  /** How it is powered (#748) - absent: by its kind (`equipmentEarth`). */
  earth: EarthSchema.optional(),
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
  /** Copied from the model where it says so (#746); absent: by kind (`equipmentMixes`). */
  mixes: z.boolean().optional(),
  /** How this one is powered (#748): set on the map ("Strom"), else the model's, else by kind. */
  earth: EarthSchema.optional(),
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
  /** What the cable does with ground (#748), where it is not what its plugs suggest: a balanced TRS
   * cable, one with an isolator (ground lift) in it. Absent: from the plugs (`cableGround`). */
  ground: z.enum(['balanced', 'unbalanced', 'ground', 'isolated']).optional(),
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
  /** The setup the Gig chose (`ShowState.activeSetupId`, #745) - absent: "Standard". */
  active: z.string().optional(),
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
  // The band's own interface in detail (Marco, 2026-11-12; Behringer's panel layout). Its routing is
  // the hardware's own, so fixed: playback 1/2 goes to Main Out and Playback A, 3/4 to Playback B,
  // the Phones play A (the A/B button switches them to 3/4 - not modelled, nor the Mix knob's
  // direct monitoring of the inputs). The inputs are what the host records; MIDI passes through.
  builtin(
    'behringer-umc204hd',
    'Behringer UMC204HD',
    'audio-interface',
    [
      container(port('usb', 'USB', 'usb-b', ['usb-audio', 'midi'], 'both'), [
        part('usb/audio-in', 'Audio ein (vom Host)', ['usb-audio'], 'in', 4),
        part('usb/audio-out', 'Audio aus (zum Host)', ['usb-audio'], 'out', 2),
        part('usb/midi-in', 'MIDI ein', ['midi'], 'in'),
        part('usb/midi-out', 'MIDI aus', ['midi'], 'out'),
      ]),
      port('in', 'Eingang', 'xlr-jack', ['audio'], 'in', 2),
      port('insert', 'Insert', 'jack-6.3', ['audio'], 'both', 2),
      port('main', 'Main Out', 'jack-6.3', ['audio'], 'out', 2),
      port('playback-a', 'Playback A', 'rca', ['audio'], 'out', 2),
      { ...port('playback-b', 'Playback B', 'rca', ['audio'], 'out', 2), firstChannel: 3 },
      stereo(port('phones', 'Phones', 'jack-6.3', ['audio'], 'out')),
      port('midi-in', 'MIDI In', 'din5', ['midi'], 'in'),
      port('midi-out', 'MIDI Out', 'din5', ['midi'], 'out'),
    ],
    fixed(
      via(at('usb/audio-in', 1), at('main', 1)),
      via(at('usb/audio-in', 2), at('main', 2)),
      via(at('usb/audio-in', 1), at('playback-a', 1)),
      via(at('usb/audio-in', 2), at('playback-a', 2)),
      via(at('usb/audio-in', 3), at('playback-b', 1)),
      via(at('usb/audio-in', 4), at('playback-b', 2)),
      via(at('usb/audio-in', 1), { kind: 'port', portId: 'phones', pin: 1 }),
      via(at('usb/audio-in', 2), { kind: 'port', portId: 'phones', pin: 2 }),
      via(at('in', 1), at('usb/audio-out', 1)),
      via(at('in', 2), at('usb/audio-out', 2)),
      via(at('usb/midi-in'), at('midi-out')),
      via(at('midi-in'), at('usb/midi-out')),
    ),
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
  // Marco's modeller (2026-11-12; NUX's panel: no MIDI DIN, MIDI only over USB). The guitar runs
  // through the effects to Main Out L/R and the Phones; the FX loop sits in that chain, Aux In and
  // the host's playback are mixed in. USB audio is 2 in / 2 out - NUX gives no channel count, to
  // check on the device. The expression jack carries no signal the map knows, so it is left out.
  // It runs on a 9 V wall wart or its battery - no earth, so it closes no hum loop itself.
  {
    ...builtin(
      'nux-mg30',
      'NUX MG-30',
      'amp-modeller',
      [
        container(port('usb', 'USB', 'usb-c', ['usb-audio', 'midi'], 'both'), [
          part('usb/audio-in', 'Audio ein (vom Host)', ['usb-audio'], 'in', 2),
          part('usb/audio-out', 'Audio aus (zum Host)', ['usb-audio'], 'out', 2),
          part('usb/midi-in', 'MIDI ein', ['midi'], 'in'),
          part('usb/midi-out', 'MIDI aus', ['midi'], 'out'),
        ]),
        port('in', 'Eingang', 'jack-6.3-ts', ['audio'], 'in'),
        stereo(port('aux', 'Aux In', 'jack-3.5', ['audio'], 'in')),
        port('send', 'FX Send', 'jack-6.3-ts', ['audio'], 'out'),
        port('return', 'FX Return', 'jack-6.3-ts', ['audio'], 'in'),
        port('main', 'Main Out L/Mono, R', 'jack-6.3', ['audio'], 'out', 2),
        stereo(port('phones', 'Phones', 'jack-3.5', ['audio'], 'out')),
      ],
      fixed(
        via(at('in'), at('send')),
        via(at('return'), at('main', 1)),
        via(at('return'), at('main', 2)),
        via(at('in'), at('main', 1)),
        via(at('in'), at('main', 2)),
        via(at('in'), { kind: 'port', portId: 'phones', pin: 1 }),
        via(at('in'), { kind: 'port', portId: 'phones', pin: 2 }),
        via(at('in'), at('usb/audio-out', 1)),
        via(at('in'), at('usb/audio-out', 2)),
        via({ kind: 'port', portId: 'aux', pin: 1 }, at('main', 1)),
        via({ kind: 'port', portId: 'aux', pin: 2 }, at('main', 2)),
        via(at('usb/audio-in', 1), at('main', 1)),
        via(at('usb/audio-in', 2), at('main', 2)),
        via(at('usb/audio-in', 1), { kind: 'port', portId: 'phones', pin: 1 }),
        via(at('usb/audio-in', 2), { kind: 'port', portId: 'phones', pin: 2 }),
        // Program changes and CCs arrive over USB and change what comes out.
        via(at('usb/midi-in'), at('main', 1)),
      ),
      true,
    ),
    earth: 'floating',
  },
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
    ...(model.mixes === undefined ? {} : { mixes: model.mixes }),
    ...(model.earth === undefined ? {} : { earth: model.earth }),
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

/** Kinds that mix what their matrix puts on one output: the app's engine (docs/31 §7c) and a mixer. */
const MIXING_KINDS: readonly EquipmentKind[] = ['stageboard', 'mixer']

/** Whether a device mixes several signals routed onto one pin (#746): what its model says, else
 * by kind - an interface, a stagebox or a splitter does not. */
export function equipmentMixes(equipment: Pick<StageEquipment, 'kind' | 'mixes'>): boolean {
  return equipment.mixes ?? MIXING_KINDS.includes(equipment.kind)
}

/** Gear that usually hangs on an earthed socket (#748): the desk, amps and modellers, active
 * speakers, lights, a stagebox. A laptop on its charger is set on the map ("Strom: geerdet"). */
const EARTHED_KINDS: readonly EquipmentKind[] = ['mixer', 'amp-modeller', 'instrument-amp', 'stagebox', 'pa', 'wedge', 'light']
/** Runs on its battery unless told otherwise: tablets and phones, mics and senders, receivers on the belt. */
const BATTERY_KINDS: readonly EquipmentKind[] = ['stageboard', 'mic-sender', 'iem-receiver', 'microphone', 'instrument', 'person', 'hall']
/** No power of its own, and the ground stops there (a DI box's transformer, an isolator, #748). */
const ISOLATING_KINDS: readonly EquipmentKind[] = ['di-box']

/** How a device is powered (#748): set on the map, else by kind. */
export function equipmentEarth(equipment: Pick<StageEquipment, 'kind' | 'earth'>): Earth {
  return equipment.earth ?? (EARTHED_KINDS.includes(equipment.kind) ? 'earthed' : BATTERY_KINDS.includes(equipment.kind) ? 'battery' : 'floating')
}

/** What a cable does with ground (#748, docs/31 §7e): a balanced audio cable (XLR, TRS on a mono
 * socket) carries the shield but the signal does not ride on it; an unbalanced one (TS jack,
 * stereo/headphone jack, RCA) carries the signal on the shield; USB and DMX tie the grounds with
 * no audio on them; MIDI DIN (opto-coupled at the input), network (transformers) and anything
 * without a wire are isolated. */
export type CableGround = 'balanced' | 'unbalanced' | 'ground' | 'isolated'

type PlugView = Pick<Port, 'connector' | 'pins'>

function endGround(port: PlugView | undefined): CableGround {
  if (!port) return 'isolated'
  switch (port.connector) {
    case 'xlr':
    case 'xlr-jack':
      return 'balanced'
    case 'jack-6.3':
      // A TRS socket (the map's "Klinke 6,3 symmetrisch") is balanced as one channel; with two pins
      // it is left and right - a stereo/headphone socket, unbalanced. A mono (TS) cable in it:
      // "Kabel und Masse: Unsymmetrisch" on the cable.
      return (port.pins ?? 1) > 1 ? 'unbalanced' : 'balanced'
    case 'jack-6.3-ts':
    case 'jack-3.5':
    case 'rca':
      return 'unbalanced'
    case 'usb-a':
    case 'usb-b':
    case 'usb-c':
    case 'dmx':
      return 'ground'
    default:
      return 'isolated'
  }
}

const GROUND_RANK: Record<CableGround, number> = { isolated: 3, unbalanced: 2, ground: 1, balanced: 0 }

/** A cable is what it says it is (an isolator in it, a balanced TRS cable), else as isolated as its
 * most isolated end, else as unbalanced as its weaker end. */
export function cableGround(a: PlugView | undefined, b: PlugView | undefined, own?: CableGround): CableGround {
  if (own) return own
  const [x, y] = [endGround(a), endGround(b)]
  if (x === 'isolated' || y === 'isolated') return 'isolated'
  return GROUND_RANK[x] >= GROUND_RANK[y] ? x : y
}

/**
 * Hum loops (#748): two earthed devices whose grounds also meet through cables. A cable carries
 * the loop current when it lies on a way between two earthed devices - it is a bridge with earthed
 * devices on both sides, or it sits in a ring of cables with two earthed devices in it. An
 * unbalanced cable there: red, "DI box or isolator". Only USB/DMX there (a laptop on its charger
 * on a Kemper's USB): a quiet hint. Balanced cables only: no finding - the shield carries it, every
 * desk to every active speaker is wired so. A DI box stops the ground; a device on battery or
 * without earth passes it on but closes no loop itself.
 */
function humLoops(onStage: readonly StageEquipment[], setup: StageSetup): StageIssue[] {
  const byId = new Map(onStage.map((e) => [e.id, e]))
  const order = new Map(onStage.map((e, i) => [e.id, i]))
  const cables: { id: string; a: string; b: string; ground: CableGround }[] = []
  for (const link of setup.links) {
    const [a, b] = [byId.get(link.from.equipmentId), byId.get(link.to.equipmentId)]
    if (!a || !b || a === b || ISOLATING_KINDS.includes(a.kind) || ISOLATING_KINDS.includes(b.kind)) continue
    const ground = cableGround(lookupPort(a.ports, link.from.portId), lookupPort(b.ports, link.to.portId), link.ground)
    if (ground !== 'isolated') cables.push({ id: link.id, a: a.id, b: b.id, ground })
  }
  const earthed = (id: string) => equipmentEarth(byId.get(id)!) === 'earthed'
  /** Earthed devices reachable from `start` without the cable `skip`, nearest first. */
  const reach = (start: string, skip: string): { all: Set<string>; earthed: string[] } => {
    const all = new Set([start])
    const found: string[] = []
    const queue = [start]
    while (queue.length > 0) {
      const at = queue.shift()!
      if (earthed(at)) found.push(at)
      for (const c of cables) {
        if (c.id === skip || (c.a !== at && c.b !== at)) continue
        const next = c.a === at ? c.b : c.a
        if (!all.has(next)) {
          all.add(next)
          queue.push(next)
        }
      }
    }
    return { all, earthed: found }
  }
  const byPair = new Map<string, { kind: 'hum-loop' | 'hum-hint'; equipmentIds: [string, string]; linkIds: string[] }>()
  for (const c of cables) {
    if (c.ground === 'balanced') continue
    const side = reach(c.a, c.id)
    let pair: string[]
    if (side.all.has(c.b)) {
      // In a ring: two earthed devices in it close the loop through this cable as well.
      pair = side.earthed.slice(0, 2)
    } else {
      const other = reach(c.b, c.id)
      pair = side.earthed[0] && other.earthed[0] ? [side.earthed[0], other.earthed[0]] : []
    }
    if (pair.length < 2) continue
    const equipmentIds = [...pair].sort((x, y) => order.get(x)! - order.get(y)!) as [string, string]
    const kind = c.ground === 'unbalanced' ? 'hum-loop' : 'hum-hint'
    const key = `${kind}|${equipmentIds.join('|')}`
    const entry = byPair.get(key) ?? { kind, equipmentIds, linkIds: [] }
    entry.linkIds.push(c.id)
    byPair.set(key, entry)
  }
  const loops = [...byPair.values()]
  // Where an unbalanced cable is the culprit, the USB on the same way is no news.
  return loops.filter((l) => l.kind === 'hum-loop' || !loops.some((o) => o.kind === 'hum-loop' && o.equipmentIds.join() === l.equipmentIds.join()))
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

type FlowStart = { equipment: StageEquipment; portId: string; channel: number | undefined; pin: number | undefined; cls: SignalClass }

/** Follows a signal from where it leaves a device through every cable and matrix of a setup,
 * filling the flow's hops, listeners and virtual inputs (shared by `signalFlows` and `checkSetup`). */
function tracer(map: StageMap, setup: StageSetup): (flow: SignalFlow, start: FlowStart[]) => void {
  const byId = new Map(map.equipment.map((e) => [e.id, e]))

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
        // A cable on one pin of a stereo socket carries that pin only.
        if (pin !== undefined && mine.pin !== undefined && mine.pin !== pin) continue
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
          out.push({ link, from, to: pin !== undefined && theirs.pin === undefined && (theirPort.pins ?? 1) > 1 ? { ...theirs, pin } : theirs })
        } else if (channel !== undefined && mine.channel !== undefined) out.push({ link, from, to: { ...theirs, channel: theirs.channel + channel - mine.channel } })
        // One pin of a stereo jack onto a group: the left on the first channel, the right on the next.
        // (A cable on that very pin lands where it says.)
        else if (pin !== undefined) out.push({ link, from, to: { ...theirs, channel: theirs.channel + (mine.pin === undefined ? pin - 1 : 0) } })
        // The whole port (a stereo jack) onto a group: every channel the cable is wide.
        else for (let k = 0; k < width; k++) out.push({ link, from, to: { ...theirs, channel: theirs.channel + k } })
      }
    }
    return out
  }

  const follow = (flow: SignalFlow, start: FlowStart[]) => {
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
  return follow
}

/**
 * Every signal of a setup and where it goes. `virtualPorts`: the band's virtual ports (names and
 * classes); an unknown id is shown by its id, as sound.
 */
export function signalFlows(map: StageMap, setupId: string, virtualPorts: readonly VirtualPort[]): SignalFlow[] {
  const setup = map.setups.find((s) => s.id === setupId)
  if (!setup) return []
  const onStage = map.equipment.filter((e) => setup.positions[e.id])
  const flows: SignalFlow[] = []

  const follow = tracer(map, setup)

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
export function linkPlaceholder(map: StageMap, placeholder: StageEquipment, deviceId: string, deviceName?: string): { linked: StageEquipment; merge: string | null } {
  const own = map.equipment.find((e) => e.kind === 'stageboard' && appsOf(e).includes(deviceId) && e.id !== placeholder.id)
  // Still called "Tablet / Handy": it takes the device's name, so the map says which one it is
  // (device test 2026-11-12, #815). A name the band gave it stays.
  const name = deviceName && hasModelName(placeholder) ? deviceName : placeholder.name
  return { linked: { ...placeholder, deviceId, name }, merge: own?.id ?? null }
}

/** Still the name its model gave it ("Tablet / Handy") - nobody named it. */
export function hasModelName(e: Pick<StageEquipment, 'name' | 'modelId'>): boolean {
  return BUILTIN_MODELS.some((m) => m.id === e.modelId && m.name === e.name)
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
  /** A mono plug in a stereo output: the right channel is shorted (#746). */
  | { kind: 'mono-in-stereo-out'; linkId: string; equipmentId: string; portId: string }
  /** One side of a stereo signal ends nowhere while the other goes on (#746): the slot of the
   * device's output that is lost. */
  | { kind: 'channel-lost'; equipmentId: string; portId: string; channel?: number; pin?: number; virtualPortId: string }
  /** Several signals on one output of a device that does not mix (#746). */
  | { kind: 'mix'; equipmentId: string; portId: string; channel?: number; pin?: number; sources: number }
  | { kind: 'adapter'; linkId: string }
  /** Two earthed devices whose grounds meet again over an unbalanced cable (#748): hum likely. */
  | { kind: 'hum-loop'; equipmentIds: [string, string]; linkIds: string[] }
  /** The same over USB/DMX only: possible, worth a look (#748). */
  | { kind: 'hum-hint'; equipmentIds: [string, string]; linkIds: string[] }
  /** Several USB audio devices on one tablet socket (a hub, #813): Android plays through only one
   * of them, and which one it picks is Android's choice (device test 2026-11-12, docs/28 §3a). */
  | { kind: 'usb-audio-shared'; equipmentId: string; portId: string; linkIds: string[] }

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
 * channels are in use. Since #746 the whole chain (docs/31 §7d): a mono plug in a stereo output (the
 * right channel is shorted), one side of a stereo signal that ends on the way while the other
 * arrives (`virtualPorts` say which signals are stereo), and several signals on one output of a
 * device that does not mix.
 */
export function checkSetup(map: StageMap, setupId: string, virtualPorts: readonly VirtualPort[] = []): { issues: StageIssue[]; use: PortUse[] } {
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
      else if (width === 1 && (port.pins ?? 1) > 1 && end.pin === undefined && port.channels === undefined) {
        // At an output the plug's sleeve shorts the right channel; at an input one side stays empty.
        const output = port.direction === 'out' || (port.direction === 'both' && end === link.from)
        issues.push({ kind: output ? 'mono-in-stereo-out' : 'mono-of-stereo', linkId: link.id, equipmentId: end.equipmentId, portId: end.portId })
      }
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
  const onStage = map.equipment.filter((e) => setup.positions[e.id])
  // Two USB audio devices on one tablet socket (#813): their cables both carry USB audio and both
  // far ends take it - Android plays through only one.
  for (const e of onStage) {
    if (e.kind !== 'stageboard') continue
    for (const port of e.ports) {
      if (!port.parts?.some((x) => x.signals.includes('usb-audio') && x.direction !== 'in')) continue
      const audio = setup.links.filter((l) => {
        if (!l.signals.includes('usb-audio')) return false
        const far = l.from.equipmentId === e.id && l.from.portId === port.id ? l.to : l.to.equipmentId === e.id && l.to.portId === port.id ? l.from : null
        const farPort = far ? byId.get(far.equipmentId)?.ports.find((p) => p.id === far.portId) : undefined
        return !!farPort?.parts?.some((x) => x.signals.includes('usb-audio') && x.direction !== 'out')
      })
      if (audio.length > 1) issues.push({ kind: 'usb-audio-shared', equipmentId: e.id, portId: port.id, linkIds: audio.map((l) => l.id) })
    }
  }
  // The whole chain (#746): a stereo signal put on a whole socket or group goes side by side -
  // when one side arrives somewhere and the other ends on the way, a channel is lost.
  const follow = tracer(map, setup)
  for (const e of onStage) {
    if (!DRIVER_KINDS.includes(e.kind)) continue
    for (const c of effectiveRouting(e, setup)) {
      // One side of the source alone ("Track L") is one channel - nothing to lose.
      if (c.from.kind !== 'virtual' || c.from.channel !== undefined || c.to.kind !== 'port' || c.to.channel !== undefined || c.to.pin !== undefined) continue
      const virtualPortId = c.from.virtualPortId
      const vp = virtualPorts.find((v) => v.id === virtualPortId)
      const builtIn = DEFAULT_VIRTUAL_OUTPUTS.find((v) => v.id === virtualPortId)
      const width = vp?.width ?? (builtIn ? virtualPortWidth(builtIn.capability) : 1)
      const cls = vp?.signalClass ?? 'sound'
      const port = lookupPort(e.ports, c.to.portId)
      if (width < 2 || !port || !classOn(port, cls, false)) continue
      const slots = portSlots(port).slice(0, width)
      if (slots.length < 2) continue
      const sides = slots.map((slot) => {
        const flow: SignalFlow = { key: '', name: '', signalClass: cls, originEquipmentId: e.id, hops: [], listenerIds: [], virtualInputs: [] }
        follow(flow, [{ equipment: e, portId: port.id, channel: slot.channel, pin: slot.pin, cls }])
        return { slot, flow }
      })
      // "Arrives": at a listener - or, while nobody is wired up yet, on any cable.
      const heard = sides.some((s) => s.flow.listenerIds.length > 0)
      const arrives = (s: (typeof sides)[number]) => (heard ? s.flow.listenerIds.length > 0 : s.flow.hops.length > 0)
      if (!sides.some(arrives)) continue
      for (const s of sides) if (!arrives(s)) issues.push({ kind: 'channel-lost', equipmentId: e.id, portId: port.id, ...s.slot, virtualPortId })
    }
  }
  // Several signals on one output of a device that does not mix. A fixed routing is the gear's own.
  for (const e of onStage) {
    if (e.routing?.mode !== 'free' || equipmentMixes(e)) continue
    const sources = new Map<string, { slot: { channel?: number; pin?: number }; portId: string; from: Set<string> }>()
    for (const c of effectiveRouting(e, setup)) {
      if (c.to.kind !== 'port') continue
      const port = lookupPort(e.ports, c.to.portId)
      if (!port || port.direction === 'in') continue
      const to = c.to
      const matching = portSlots(port).filter((s) => (to.channel === undefined || (s.channel ?? 1) === to.channel) && (to.pin === undefined || (s.pin ?? 1) === to.pin))
      // A part takes its channels from the far end - the point names one the port does not list.
      const slots = matching.length > 0 ? matching : [{ ...(to.channel === undefined ? {} : { channel: to.channel }), ...(to.pin === undefined ? {} : { pin: to.pin }) }]
      for (const slot of slots) {
        const key = `${port.id}|${slotKey(slot)}`
        const entry = sources.get(key) ?? { slot, portId: port.id, from: new Set<string>() }
        entry.from.add(JSON.stringify(c.from))
        sources.set(key, entry)
      }
    }
    for (const { slot, portId, from } of sources.values()) if (from.size > 1) issues.push({ kind: 'mix', equipmentId: e.id, portId, ...slot, sources: from.size })
  }
  issues.push(...humLoops(onStage, setup))
  const use: PortUse[] = []
  for (const e of onStage) {
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

/**
 * The setup a band plays by (docs/31 §6 step 5, #745): the one the master chose for the Gig
 * (`map.active`), else - nothing chosen, or the chosen one is gone - "Standard", else the first.
 * Never somebody's own setup (#799).
 */
export function activeSetup(map: StageMap): StageSetup | null {
  const chosen = map.active !== undefined ? map.setups.find((s) => s.id === map.active && s.owner === undefined) : undefined
  return chosen ?? map.setups.find((s) => s.id === DEFAULT_SETUP_ID) ?? map.setups[0] ?? null
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
  /** Only this side of a stereo source goes there (1 = its left, 2 = its right) - absent: all of it. */
  channel?: 1 | 2
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
    const channel = c.from.channel === 1 || c.from.channel === 2 ? c.from.channel : undefined
    out.push({ portId: c.to.portId, route: untouched ? 'any' : playable ? routeOfConnector(port.connector) : 'none', side, ...(channel ? { channel } : {}) })
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

/** What one side of the device's output gets from a source: its left (`L`), its right (`R`), both
 * summed (`mix`), or nothing. */
export type SideFeed = 'L' | 'R' | 'mix' | null
/** A source on the device's stereo output: what its left and its right side get. */
export interface SourceFeeds {
  left: SideFeed
  right: SideFeed
}
/** As always: left on the left, right on the right (a mono source on both). */
export const STEREO_FEEDS: SourceFeeds = { left: 'L', right: 'R' }

/**
 * What a source gives each side while Android is on `route`, from its `mapOutputs` (#742; the
 * sides of a stereo source alone since 2026-11-12): only the points on that output count. The
 * whole source on both sides keeps its left left and its right right - on one side only it is
 * summed there; "Track L" or "Track R" goes alone wherever it is put, two things on one side are
 * summed. Null: none of its points is on that output - the source stays silent, never played
 * somewhere else (docs/28). A browser cannot tell the route (`unknown`): every playable point
 * counts there. `stereo` false (click, announcements): one signal, `mix` wherever it goes.
 */
export function outputFeeds(outputs: readonly MapOutput[], route: string, stereo = true): SourceFeeds | null {
  const here = outputs.filter((o) => o.route === 'any' || (o.route !== 'none' && (route === 'unknown' || o.route === route)))
  if (here.length === 0) return null
  const sidesOf = (o: MapOutput): ('left' | 'right')[] => (o.side === 'both' ? ['left', 'right'] : [o.side])
  const got = { left: new Set<'L' | 'R'>(), right: new Set<'L' | 'R'>() }
  const whole = new Set(here.filter((o) => o.channel === undefined).flatMap(sidesOf))
  if (whole.size === 2) {
    got.left.add('L')
    got.right.add('R')
  } else for (const side of whole) got[side].add('L').add('R')
  for (const o of here) if (o.channel) for (const side of sidesOf(o)) got[side].add(o.channel === 1 ? 'L' : 'R')
  const feed = (set: Set<'L' | 'R'>): SideFeed => (set.size === 0 ? null : !stereo || set.size === 2 ? 'mix' : set.has('L') ? 'L' : 'R')
  const feeds = { left: feed(got.left), right: feed(got.right) }
  // A mono source on both sides is the same signal on both - as always.
  return !stereo && feeds.left && feeds.right ? STEREO_FEEDS : feeds
}

/** Klick, Track and Ansagen - decided by mapPlays, not by mapRoute. */
export const BUILT_IN_OUTPUT_CAPABILITIES: readonly CapabilityId[] = DEFAULT_VIRTUAL_OUTPUTS.map((v) => v.capability)

/**
 * Where the map sends a virtual port (a Logical Device - "Kemper") in the active setup (docs/31 §6
 * step 2, part 2, 2026-11-07): the app that executes it - the device whose matrix routes it to one
 * of its ports, the one in front of several apps there, or the Stage-Server - and the MIDI port
 * name on the cable from that port, if one is set. `app: null`: the map routes it nowhere, nobody
 * sends. Null without a map - the old binding applies. `setupId`: a setup other than the active
 * one (practising "as in setup …", #799).
 */
export function mapRoute(map: StageMap, virtualPortId: string, frontApp: Readonly<Record<string, string>> = {}, setupId?: string, pluginId?: string | null): { app: string | null; midiName: string | null } | null {
  const setup = setupOf(map, setupId)
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
    const cables = setup.links.filter((l) => (l.from.equipmentId === box.id && l.from.portId === portId) || (l.to.equipmentId === box.id && l.to.portId === portId))
    // Several cables on one socket (a hub on the tablet's USB-C, #813): the one to the device this
    // plugin drives (MG-30 model ↔ MG-30 plugin), else one that names its MIDI port, else the first.
    const farModel = (l: StageLink) => map.equipment.find((e) => e.id === (l.from.equipmentId === box.id ? l.to.equipmentId : l.from.equipmentId))?.modelId
    const cable = (pluginId ? cables.find((l) => farModel(l) === pluginId) : undefined) ?? cables.find((l) => l.midiName) ?? cables[0]
    return { app, midiName: cable?.midiName ?? null }
  }
  return { app: null, midiName: null }
}

/** The Logical Devices as the map says: every one but Klick/Track/Ansagen executes where mapRoute
 * sends it. Without a map, as stored. */
export function routedLogicalDevices<T extends { id: string; capability: string; executionTarget: string | null; pluginId?: string | null }>(devices: readonly T[], map: StageMap, frontApp: Readonly<Record<string, string>> = {}, setupId?: string): T[] {
  if (!setupOf(map, setupId)) return [...devices]
  return devices.map((d) => {
    if (BUILT_IN_OUTPUT_CAPABILITIES.includes(d.capability as CapabilityId)) return d
    const route = mapRoute(map, d.id, frontApp, setupId, d.pluginId)
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

/** Equipment from the database read the new way (#739) - no write, the band's documents stay as
 * they are. A StageBoard device on a built-in model takes its ports from the model: nobody can set
 * a tablet's ports up, so the copy stored when it joined only goes stale (2026-11-12: tablets added
 * before #739 had mono headphones). */
export function normalizeEquipment(equipment: StageEquipment): StageEquipment {
  const model = equipment.kind === 'stageboard' ? BUILTIN_MODELS.find((m) => m.id === equipment.modelId && m.kind === 'stageboard') : undefined
  return { ...equipment, ports: (model?.ports ?? equipment.ports).map(normalizePort) }
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
