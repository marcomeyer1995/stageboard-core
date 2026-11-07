import { describe, expect, it } from 'vitest'
import { CAPABILITIES } from './capability.js'
import {
  addDeviceToMap,
  BUILTIN_MODELS,
  DEFAULT_SETUP_ID,
  defaultStageMap,
  effectiveRouting,
  equipmentFrom,
  portFit,
  signalFlows,
  StageMapSchema,
  type Crosspoint,
  type Port,
  type StageLink,
  type StageMap,
  type VirtualPort,
  pruneForPorts,
  channelNumber,
  numberPorts,
  mapPlays,
  checkSetup,
  wiringList,
  signalFlows as flowsOf,
  linkPlaceholder,
  mergeEquipmentInSetup,
} from './stageMap.js'

const model = (id: string) => BUILTIN_MODELS.find((m) => m.id === id)!
const portOf = (modelId: string, portId: string): Port => model(modelId).ports.find((p) => p.id === portId)!

const VIRTUAL: VirtualPort[] = [
  { id: 'klick', name: 'Klick', signalClass: 'sound', input: false },
  { id: 'track', name: 'Track', signalClass: 'sound', input: false },
  { id: 'ansagen', name: 'Ansagen', signalClass: 'sound', input: false },
  { id: 'kemper', name: 'Kemper', signalClass: 'midi', input: false },
  { id: 'pedal', name: 'Pedal', signalClass: 'midi', input: true },
]

describe('portFit (lenient, decision 2)', () => {
  it('needs an output into an input sharing a signal', () => {
    expect(portFit(portOf('tablet', 'speaker'), portOf('person', 'ears'))).toEqual({ signals: ['audio'], adapter: false })
    expect(portFit(portOf('person', 'ears'), portOf('tablet', 'speaker'))).toBeNull()
    expect(portFit(portOf('tablet', 'speaker'), portOf('light', 'dmx'))).toBeNull()
  })

  it('a USB cable carries what both ends share', () => {
    expect(portFit(portOf('tablet', 'usb'), portOf('audio-interface', 'usb'))).toEqual({ signals: ['usb-audio', 'midi'], adapter: false })
    expect(portFit(portOf('tablet', 'usb'), portOf('amp-modeller', 'usb'))).toEqual({ signals: ['midi'], adapter: false })
  })

  it('a different plug only warns', () => {
    expect(portFit(portOf('tablet', 'headphones'), portOf('mixer', 'in'))).toEqual({ signals: ['audio'], adapter: true })
    expect(portFit(portOf('audio-interface', 'out12'), portOf('mixer', 'in'))).toEqual({ signals: ['audio'], adapter: false })
  })
})

describe('default map (decision 6)', () => {
  const map = defaultStageMap([
    { id: 'redmi', name: 'Redmi' },
    { id: 'fire', name: 'Fire' },
  ])

  it('every device routes Klick, Track and Ansagen to its own speaker, heard by whoever is signed in there', () => {
    expect(StageMapSchema.parse(map)).toEqual(map)
    const flows = signalFlows(map, DEFAULT_SETUP_ID, VIRTUAL)
    expect(flows.map((f) => [f.key, f.listenerIds])).toEqual([
      ['device:redmi/klick', ['listener:redmi']],
      ['device:redmi/track', ['listener:redmi']],
      ['device:redmi/ansagen', ['listener:redmi']],
      ['device:fire/klick', ['listener:fire']],
      ['device:fire/track', ['listener:fire']],
      ['device:fire/ansagen', ['listener:fire']],
    ])
    expect(map.equipment.find((e) => e.id === 'listener:fire')!.listener).toEqual({ kind: 'signed-in', deviceId: 'fire' })
  })

  it('a new device joins the same way, in every setup; one already on the map stays as the band left it', () => {
    const twoSetups: StageMap = { ...map, setups: [...map.setups, { id: 'club', name: 'Club', positions: {}, links: [], routing: {} }] }
    const more = addDeviceToMap(twoSetups, { id: 'phone', name: 'Handy' })
    for (const setup of more.setups) expect(setup.links.filter((l) => l.id === 'default:phone')).toHaveLength(1)
    expect(addDeviceToMap(more, { id: 'phone', name: 'Handy' })).toBe(more)
  })
})

describe('routing and signal flows', () => {
  const link = (id: string, from: string, fp: string, to: string, tp: string, signals: StageLink['signals'], ch: { from?: number; to?: number } = {}): StageLink => ({
    id,
    from: ch.from === undefined ? { equipmentId: from, portId: fp } : { equipmentId: from, portId: fp, channel: ch.from },
    to: ch.to === undefined ? { equipmentId: to, portId: tp } : { equipmentId: to, portId: tp, channel: ch.to },
    signals,
  })
  const stage = (links: StageLink[], routing: Record<string, Crosspoint[]> = {}): StageMap => {
    const equipment = [
      equipmentFrom(model('tablet'), 'redmi', 'Redmi', { deviceId: 'redmi' }),
      equipmentFrom(model('amp-modeller'), 'kemper', 'Kemper'),
      equipmentFrom(model('mixer'), 'mixer', 'Pult'),
      equipmentFrom(model('iem-sender'), 'iem', 'In-Ear Kai'),
      equipmentFrom(model('person'), 'kai', 'Kai', { listener: { kind: 'profile', profileId: 'kai' } }),
      equipmentFrom(model('pa'), 'pa', 'PA'),
      equipmentFrom(model('hall'), 'hall', 'Saal'),
      equipmentFrom(model('midi-controller'), 'pedal', 'Pedal'),
    ]
    return { equipment, setups: [{ id: 'club', name: 'Club', positions: Object.fromEntries(equipment.map((e) => [e.id, { x: 0, y: 0 }])), links, routing }] }
  }
  const onward = [
    link('aux', 'mixer', 'aux', 'iem', 'in', ['audio'], { from: 1 }),
    link('radio', 'iem', 'out', 'kai', 'ears', ['audio']),
    link('main', 'mixer', 'main', 'pa', 'in', ['audio']),
    link('room', 'pa', 'out', 'hall', 'ears', ['audio']),
  ]
  const clickIntoMixer = link('click', 'redmi', 'headphones', 'mixer', 'in', ['audio'], { to: 15 })
  const redmiRouting: Crosspoint[] = [{ from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones' } }]

  it('a mixer starts empty: the click reaches nobody until its input is routed - then only where it is routed', () => {
    const empty = stage([clickIntoMixer, ...onward], { redmi: redmiRouting })
    const [click] = signalFlows(empty, 'club', VIRTUAL)
    expect([click!.name, click!.listenerIds]).toEqual(['Klick', []])

    const routed = stage([clickIntoMixer, ...onward], { redmi: redmiRouting, mixer: [{ from: { kind: 'port', portId: 'in', channel: 15 }, to: { kind: 'port', portId: 'aux', channel: 1 } }] })
    const [flow] = signalFlows(routed, 'club', VIRTUAL)
    expect(flow!.listenerIds).toEqual(['kai'])
    expect(flow!.hops.map((h) => h.linkId)).toEqual(['click', 'aux', 'radio'])
  })

  it('a fixed routing ignores what a setup says; a free one starts from its default', () => {
    const map = stage([], { iem: [] })
    const setup = map.setups[0]!
    // The in-ear sender's two inputs (L/R) both go on air.
    expect(effectiveRouting(map.equipment.find((e) => e.id === 'iem')!, setup)).toEqual([
      { from: { kind: 'port', portId: 'in', channel: 1 }, to: { kind: 'port', portId: 'out' } },
      { from: { kind: 'port', portId: 'in', channel: 2 }, to: { kind: 'port', portId: 'out' } },
    ])
    expect(effectiveRouting(map.equipment.find((e) => e.id === 'redmi')!, setup).map((c) => (c.from as { virtualPortId: string }).virtualPortId)).toEqual(['klick', 'track', 'ansagen'])
  })

  it('MIDI to gear that sounds goes on as sound; sound into a MIDI-only port stops', () => {
    const map = stage(
      [link('usb', 'redmi', 'usb', 'kemper', 'usb', ['midi']), link('amp', 'kemper', 'main', 'mixer', 'in', ['audio'], { to: 3 }), ...onward],
      {
        redmi: [
          { from: { kind: 'virtual', virtualPortId: 'kemper' }, to: { kind: 'port', portId: 'usb' } },
          { from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'usb' } },
        ],
        mixer: [{ from: { kind: 'port', portId: 'in', channel: 3 }, to: { kind: 'port', portId: 'main' } }],
      },
    )
    const flows = signalFlows(map, 'club', VIRTUAL)
    expect(flows.find((f) => f.name === 'Kemper')!.listenerIds).toEqual(['hall'])
    expect(flows.find((f) => f.name === 'Kemper')!.hops.map((h) => h.linkId)).toEqual(['usb', 'amp', 'main', 'room'])
    expect(flows.find((f) => f.name === 'Klick')!.hops).toEqual([])
  })

  it('a pedal on the tablet\'s USB reaches the virtual input it is routed to - over a two-way cable drawn either way', () => {
    const map = stage([link('pedal-usb', 'redmi', 'usb', 'pedal', 'usb', ['midi'])], {
      redmi: [{ from: { kind: 'port', portId: 'usb' }, to: { kind: 'virtual', virtualPortId: 'pedal' } }],
    })
    const pedal = signalFlows(map, 'club', VIRTUAL).find((f) => f.originEquipmentId === 'pedal')!
    expect(pedal.virtualInputs).toEqual([{ equipmentId: 'redmi', virtualPortId: 'pedal' }])
    expect(pedal.hops.map((h) => [h.from.equipmentId, h.to.equipmentId])).toEqual([['pedal', 'redmi']])
  })
})

describe('changing a port list (Marco, 2026-11-07)', () => {
  it('fewer inputs drop the cables and matrix points that no longer fit - nothing else', () => {
    const setup = {
      id: 's',
      name: 'Club',
      positions: {},
      links: [
        { id: 'a', from: { equipmentId: 'tab', portId: 'headphones' }, to: { equipmentId: 'pult', portId: 'in', channel: 15 }, signals: ['audio' as const] },
        { id: 'b', from: { equipmentId: 'tab', portId: 'headphones' }, to: { equipmentId: 'pult', portId: 'in', channel: 3 }, signals: ['audio' as const] },
      ],
      routing: { pult: [{ from: { kind: 'port' as const, portId: 'in', channel: 15 }, to: { kind: 'port' as const, portId: 'aux', channel: 1 } }] },
    }
    const ports = [
      { id: 'in', name: 'Eingang', connector: 'xlr-jack' as const, signals: ['audio' as const], direction: 'in' as const, channels: 8 },
      { id: 'aux', name: 'Aux', connector: 'jack-6.3-ts' as const, signals: ['audio' as const], direction: 'out' as const, channels: 6 },
    ]
    const pruned = pruneForPorts(setup, 'pult', ports)
    expect(pruned.setup.links.map((l) => l.id)).toEqual(['b'])
    expect(pruned).toMatchObject({ links: 1, crosspoints: 1 })
  })

  it('channel numbers follow the desk', () => {
    const [, xlr] = numberPorts([
      { id: 'in', name: 'Eingang', connector: 'xlr-jack', signals: ['audio'], direction: 'in', channels: 10 },
      { id: 'in-xlr', name: 'Eingang', connector: 'xlr', signals: ['audio'], direction: 'in', channels: 10 },
    ])
    expect(channelNumber(xlr, 1)).toBe(11)
  })
})

describe('in-ear receiver (Marco, 2026-11-07)', () => {
  it('the radio link from the sender fits the receiver, its earphones fit a person', () => {
    const model = (id: string) => BUILTIN_MODELS.find((m) => m.id === id)!
    const out = model('iem-sender').ports.find((p) => p.id === 'out')!
    const radio = model('iem-receiver').ports.find((p) => p.id === 'in')!
    const phones = model('iem-receiver').ports.find((p) => p.id === 'phones')!
    const ears = model('person').ports.find((p) => p.id === 'ears')!
    expect(portFit(out, radio)).not.toBeNull()
    expect(portFit(phones, ears)).not.toBeNull()
  })
})

describe('built-in equipment', () => {
  it('every routing point names a port the model has, and a channel inside its group', () => {
    for (const model of BUILTIN_MODELS) {
      for (const c of model.routing?.default ?? []) {
        for (const pt of [c.from, c.to]) {
          if (pt.kind !== 'port') continue
          const p = model.ports.find((x) => x.id === pt.portId)
          expect(p, `${model.id}: ${pt.portId}`).toBeDefined()
          if (pt.channel !== undefined) expect(pt.channel).toBeLessThanOrEqual(p!.channels ?? 0)
        }
      }
    }
  })

  it('a guitar goes into a DI box, the DI box into the stagebox, the stagebox into the desk', () => {
    const model = (id: string) => BUILTIN_MODELS.find((m) => m.id === id)!
    const portOf = (id: string, portId: string) => model(id).ports.find((p) => p.id === portId)!
    expect(portFit(portOf('instrument', 'out'), portOf('di-box', 'in'))).not.toBeNull()
    expect(portFit(portOf('di-box', 'out'), portOf('stagebox', 'in'))).not.toBeNull()
    expect(portFit(portOf('stagebox', 'out'), portOf('mixer', 'in'))).not.toBeNull()
    expect(portFit(portOf('mic-receiver', 'out'), portOf('mixer', 'in'))).not.toBeNull()
  })
})

describe('placeholder tablets (Marco, 2026-11-07)', () => {
  it('linking takes over the device the map added on its own: its cable, position and matrix move to the placeholder', () => {
    const map = defaultStageMap([{ id: 'kai', name: 'Tablet Kai' }])
    const placeholder = equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'tablet')!, 'ph', 'Kai (geplant)')
    map.equipment.push(placeholder)
    map.setups[0]!.positions.ph = { x: 10, y: 10 }
    const { linked, merge } = linkPlaceholder(map, placeholder, 'kai')
    expect(linked.deviceId).toBe('kai')
    expect(merge).toBe('device:kai')
    const merged = mergeEquipmentInSetup(map.setups[0]!, merge!, 'ph')
    expect(merged.positions.ph).toEqual({ x: 10, y: 10 })
    expect(merged.positions['device:kai']).toBeUndefined()
    expect(merged.links.map((l) => [l.from.equipmentId, l.to.equipmentId])).toEqual([['ph', 'listener:kai']])
  })

  it('a device not yet on the map: nothing to merge', () => {
    const map = defaultStageMap([])
    const placeholder = equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'tablet')!, 'ph', 'Kai (geplant)')
    expect(linkPlaceholder(map, placeholder, 'kai').merge).toBeNull()
  })
})

describe('free port list (Marco, 2026-11-07)', () => {
  it('numbers groups of the same name on, like the desk', () => {
    const ports = numberPorts([
      { id: 'a', name: 'Eingang', connector: 'xlr-jack', signals: ['audio'], direction: 'in', channels: 10 },
      { id: 'b', name: 'Eingang', connector: 'xlr', signals: ['audio'], direction: 'in', channels: 10 },
      { id: 'c', name: 'Aux', connector: 'jack-6.3-ts', signals: ['audio'], direction: 'out', channels: 6 },
    ])
    expect(ports.map((p) => p.firstChannel)).toEqual([undefined, 11, undefined])
  })

  it('a mono jack (TS) Aux out takes a jack cable and a combo socket - like the CQ-18T', () => {
    const aux = { id: 'aux', name: 'Aux', connector: 'jack-6.3-ts' as const, signals: ['audio' as const], direction: 'out' as const, channels: 6 }
    const wedge = BUILTIN_MODELS.find((m) => m.id === 'wedge')!.ports.find((p) => p.id === 'in')!
    expect(portFit(aux, wedge)?.adapter).toBe(false)
  })
})

describe('channels, checks and the wiring list (Marco, 2026-11-07)', () => {
  const model = (id: string) => BUILTIN_MODELS.find((m) => m.id === id)!
  const build = (links: StageLink[]): StageMap => {
    const pult = equipmentFrom(model('mixer'), 'pult', 'Pult')
    const iem = equipmentFrom(model('iem-sender'), 'iem', 'IEM Kai')
    const wedge = equipmentFrom(model('wedge'), 'wedge', 'Wedge')
    const at = { x: 0, y: 0 }
    return { equipment: [pult, iem, wedge], setups: [{ id: 's', name: 'Club', positions: { pult: at, iem: at, wedge: at }, links, routing: {} }] }
  }

  it('Aux 1-2 in stereo into the in-ear sender: one line, two cables on the list, both inputs taken', () => {
    const map = build([{ id: 'st', from: { equipmentId: 'pult', portId: 'aux', channel: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'], width: 2 }])
    const cables = wiringList(map, 's')
    expect(cables.map((c) => [c.number, c.from.channel, c.to.channel])).toEqual([
      [1, 1, 1],
      [2, 2, 2],
    ])
    const { issues, use } = checkSetup(map, 's')
    expect(issues).toEqual([])
    expect(use.find((u) => u.equipmentId === 'pult' && u.portId === 'aux')).toMatchObject({ used: 2, total: 4 })
    expect(use.find((u) => u.equipmentId === 'iem' && u.portId === 'in')).toMatchObject({ used: 2, total: 2 })
  })

  it('a second cable on a taken channel is red; stereo into a mono wedge is too wide', () => {
    const map = build([
      { id: 'a', from: { equipmentId: 'pult', portId: 'aux', channel: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'] },
      { id: 'b', from: { equipmentId: 'pult', portId: 'aux', channel: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 2 }, signals: ['audio'] },
      { id: 'c', from: { equipmentId: 'pult', portId: 'aux', channel: 3 }, to: { equipmentId: 'wedge', portId: 'in' }, signals: ['audio'], width: 2 },
    ])
    const { issues } = checkSetup(map, 's')
    expect(issues).toContainEqual({ kind: 'double', equipmentId: 'pult', portId: 'aux', channel: 1, linkIds: ['a', 'b'] })
    expect(issues).toContainEqual({ kind: 'width', linkId: 'c', equipmentId: 'wedge', portId: 'in', width: 2, capacity: 1 })
  })

  it('a stereo jack onto two desk channels is one Y cable', () => {
    const tablet = equipmentFrom(model('tablet'), 'tab', 'Redmi', { deviceId: 'r' })
    const map = build([{ id: 'y', from: { equipmentId: 'tab', portId: 'headphones' }, to: { equipmentId: 'pult', portId: 'in', channel: 15 }, signals: ['audio'], width: 2 }])
    map.equipment.push(tablet)
    map.setups[0]!.positions.tab = { x: 0, y: 0 }
    expect(wiringList(map, 's').map((c) => c.y)).toEqual([true])
    // A speaker to whoever listens is no cable.
    map.setups[0]!.links.push({ id: 'ear', from: { equipmentId: 'tab', portId: 'speaker' }, to: { equipmentId: 'wedge', portId: 'in' }, signals: ['audio'] })
    expect(wiringList(map, 's')).toHaveLength(1)
    expect(checkSetup(map, 's').use.find((u) => u.portId === 'in' && u.equipmentId === 'pult')).toMatchObject({ used: 2, total: 16 })
  })
})

describe('the map decides who plays (docs/31 §6 step 2, 2026-11-07)', () => {
  it('the default map: every device plays Klick, Track and Ansagen on its speaker', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }, { id: 'fire', name: 'Fire' }])
    for (const id of ['redmi', 'fire']) for (const c of [CAPABILITIES.clickTrack, CAPABILITIES.audioPlayback, CAPABILITIES.sectionAnnouncements]) expect(mapPlays(map, id, c)).toBe(true)
  })

  it('a device whose matrix routes only the click plays only the click; one off the stage plays nothing; no map: the old rules', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }, { id: 'fire', name: 'Fire' }])
    map.setups[0]!.routing['device:redmi'] = [{ from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones' } }]
    delete map.setups[0]!.positions['device:fire']
    expect(mapPlays(map, 'redmi', CAPABILITIES.clickTrack)).toBe(true)
    expect(mapPlays(map, 'redmi', CAPABILITIES.audioPlayback)).toBe(false)
    expect(mapPlays(map, 'fire', CAPABILITIES.clickTrack)).toBe(false)
    expect(mapPlays(map, 'laptop', CAPABILITIES.clickTrack)).toBe(false)
    expect(mapPlays({ equipment: [], setups: [] }, 'redmi', CAPABILITIES.clickTrack)).toBeNull()
  })
})
