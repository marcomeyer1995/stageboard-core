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
  activeSetup,
  mapPlays,
  mapOutputs,
  visibleOwnSetups,
  equipmentOffered,
  ownSetupFrom,
  outputFeeds,
  STEREO_FEEDS,
  mapRoute,
  routedLogicalDevices,
  joinDevices,
  separateApp,
  appsOf,
  cableGround,
  checkSetup,
  equipmentEarth,
  equipmentMixes,
  wiringList,
  signalFlows as flowsOf,
  linkPlaceholder,
  mergeEquipmentInSetup,
  lookupPort,
  cablePortId,
  normalizePort,
  normalizeEquipment,
  partChannels,
  portSlots,
  portCapacity,
  PortSchema,
  type StageSetup,
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
    expect(portFit(portOf('audio-interface', 'out'), portOf('mixer', 'in'))).toEqual({ signals: ['audio'], adapter: false })
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
          const p = lookupPort(model.ports, pt.portId)
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
  it('the Gig chooses the setup (#745): the click moves to the other tablet; a setup that is gone or somebody\'s own never applies', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }, { id: 'fire', name: 'Fire' }])
    const standard = map.setups[0]!
    const click = (portId: string) => [{ from: { kind: 'virtual' as const, virtualPortId: 'klick' }, to: { kind: 'port' as const, portId } }]
    standard.routing = { 'device:redmi': click('headphones'), 'device:fire': [] }
    map.setups.push({ ...standard, id: 'club', name: 'Club', routing: { 'device:redmi': [], 'device:fire': click('headphones') } })
    map.setups.push({ ...standard, id: 'home', name: 'Zuhause', owner: 'marco', routing: { 'device:redmi': [], 'device:fire': [] } })
    const plays = (active?: string) => ['redmi', 'fire'].map((id) => mapPlays({ ...map, active }, id, CAPABILITIES.clickTrack))
    expect(plays()).toEqual([true, false])
    expect(plays('club')).toEqual([false, true])
    expect(activeSetup({ ...map, active: 'club' })?.id).toBe('club')
    expect(plays('gone')).toEqual([true, false])
    expect(plays('home')).toEqual([true, false])
  })

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

describe('the sound follows the map (#742, docs/31 §0d)', () => {
  const to = (virtualPortId: string, portId: string, pin?: number) => ({ from: { kind: 'virtual' as const, virtualPortId }, to: pin === undefined ? { kind: 'port' as const, portId } : { kind: 'port' as const, portId, pin } })

  it('the untouched default map plays wherever Android plays, as before', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
    const outputs = mapOutputs(map, 'redmi', CAPABILITIES.clickTrack)!
    expect(outputs).toEqual([{ portId: 'speaker', route: 'any', side: 'both' }])
    expect(outputFeeds(outputs, 'wired', false)).toEqual(STEREO_FEEDS)
  })

  it('click on the left pin of the headphones, track on the right; only on that output', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
    map.setups[0]!.routing['device:redmi'] = [to('klick', 'headphones', 1), to('track', 'headphones', 2)]
    const click = mapOutputs(map, 'redmi', CAPABILITIES.clickTrack)!
    const track = mapOutputs(map, 'redmi', CAPABILITIES.audioPlayback)!
    expect(click).toEqual([{ portId: 'headphones', route: 'wired', side: 'left' }])
    expect(outputFeeds(click, 'wired', false)).toEqual({ left: 'mix', right: null })
    // The stereo track on one pin is summed there.
    expect(outputFeeds(track, 'wired')).toEqual({ left: null, right: 'mix' })
    // Headphones pulled: Android is on the speaker - the click does not come out there.
    expect(outputFeeds(click, 'speaker', false)).toBeNull()
    // A browser cannot tell the route.
    expect(outputFeeds(click, 'unknown', false)).toEqual({ left: 'mix', right: null })
    expect(mapOutputs(map, 'redmi', CAPABILITIES.sectionAnnouncements)).toEqual([])
  })

  it('both pins or the whole socket: both sides; a USB part by channel; channel 3 waits for #743', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
    map.setups[0]!.routing['device:redmi'] = [
      to('klick', 'headphones', 1),
      to('klick', 'headphones', 2),
      { from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'usb/audio-out', channel: 2 } },
      { from: { kind: 'virtual', virtualPortId: 'ansagen' }, to: { kind: 'port', portId: 'usb/audio-out', channel: 3 } },
    ]
    expect(outputFeeds(mapOutputs(map, 'redmi', CAPABILITIES.clickTrack)!, 'wired', false)).toEqual(STEREO_FEEDS)
    expect(mapOutputs(map, 'redmi', CAPABILITIES.audioPlayback)).toEqual([{ portId: 'usb/audio-out', route: 'usb', side: 'right' }])
    const voice = mapOutputs(map, 'redmi', CAPABILITIES.sectionAnnouncements)!
    expect(voice[0]!.route).toBe('none')
    expect(outputFeeds(voice, 'usb', false)).toBeNull()
  })

  it('the sides of a stereo source alone (2026-11-12): a point may name "Track L" or "Track R"', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
    const side = (channel: 1 | 2, cross: { channel?: number; pin?: number }) => ({ from: { kind: 'virtual' as const, virtualPortId: 'track', channel }, to: { kind: 'port' as const, portId: 'usb/audio-out', ...cross } })
    map.setups[0]!.routing['device:redmi'] = [side(2, { channel: 1 }), side(1, { channel: 2 })]
    const track = mapOutputs(map, 'redmi', CAPABILITIES.audioPlayback)!
    expect(track).toEqual([
      { portId: 'usb/audio-out', route: 'usb', side: 'left', channel: 2 },
      { portId: 'usb/audio-out', route: 'usb', side: 'right', channel: 1 },
    ])
    expect(outputFeeds(track, 'usb')).toEqual({ left: 'R', right: 'L' })
    // Both sides of the track on one channel: summed there.
    map.setups[0]!.routing['device:redmi'] = [side(1, { channel: 1 }), side(2, { channel: 1 })]
    expect(outputFeeds(mapOutputs(map, 'redmi', CAPABILITIES.audioPlayback)!, 'usb')).toEqual({ left: 'mix', right: null })
  })

  it('another setup by id (practising "as in setup …")', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
    map.setups.push({ ...map.setups[0]!, id: 'club', name: 'Club', routing: { 'device:redmi': [to('klick', 'bluetooth')] } })
    expect(mapOutputs(map, 'redmi', CAPABILITIES.clickTrack, {}, 'club')).toEqual([{ portId: 'bluetooth', route: 'bluetooth', side: 'both' }])
    expect(mapOutputs(map, 'redmi', CAPABILITIES.clickTrack)![0]!.route).toBe('any')
  })
})

describe('several apps on one device (Marco, 2026-11-07)', () => {
  it('the Dev app joined into the release app\'s box: one box, both apps, only the one in front plays', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }, { id: 'redmi-dev', name: 'Redmi Dev' }])
    const keep = map.equipment.find((e) => e.deviceId === 'redmi')!
    const merge = map.equipment.find((e) => e.deviceId === 'redmi-dev')!
    const joined = joinDevices(keep, merge)
    expect(appsOf(joined)).toEqual(['redmi', 'redmi-dev'])
    const after = { equipment: [...map.equipment.filter((e) => e.id !== merge.id && e.id !== keep.id), joined], setups: map.setups.map((s) => mergeEquipmentInSetup(s, merge.id, keep.id)) }
    expect(mapPlays(after, 'redmi-dev', CAPABILITIES.clickTrack)).toBe(true)
    expect(mapPlays(after, 'redmi-dev', CAPABILITIES.clickTrack, { [keep.id]: 'redmi' })).toBe(false)
    expect(mapPlays(after, 'redmi', CAPABILITIES.clickTrack, { [keep.id]: 'redmi' })).toBe(true)
    expect(appsOf(separateApp(joined, 'redmi-dev'))).toEqual(['redmi'])
  })

  it('the Stage-Server joins the laptop: the server is one of its apps', () => {
    const laptop = equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'tablet')!, 'device:laptop', 'Laptop', { deviceId: 'laptop' })
    const server = equipmentFrom(BUILTIN_MODELS.find((m) => m.id === 'stage-server')!, 'server', 'Stage-Server')
    expect(appsOf(joinDevices(laptop, server))).toEqual(['laptop', 'server'])
  })
})

describe('plugins follow the map (docs/31 §6 step 2, part 2, 2026-11-07)', () => {
  const kemperModel = BUILTIN_MODELS.find((m) => m.id === 'amp-modeller')!
  const withKemper = () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }, { id: 'fire', name: 'Fire' }])
    map.equipment.push(equipmentFrom(kemperModel, 'kemper', 'Kemper'))
    map.setups[0]!.positions.kemper = { x: 0, y: 0 }
    return map
  }

  it('the Redmi routes "Kemper" to its USB, a cable to the Kemper names the port: the Redmi sends, on that port', () => {
    const map = withKemper()
    map.setups[0]!.routing['device:redmi'] = [{ from: { kind: 'virtual', virtualPortId: 'ld-kemper' }, to: { kind: 'port', portId: 'usb' } }]
    map.setups[0]!.links.push({ id: 'usb', from: { equipmentId: 'device:redmi', portId: 'usb' }, to: { equipmentId: 'kemper', portId: 'usb' }, signals: ['midi'], midiName: 'Kemper Player' })
    expect(mapRoute(map, 'ld-kemper')).toEqual({ app: 'redmi', midiName: 'Kemper Player' })
    const lds = routedLogicalDevices([{ id: 'ld-kemper', capability: 'kemper-control', executionTarget: 'fire' }, { id: 'klick', capability: CAPABILITIES.clickTrack, executionTarget: 'fire' }], map)
    expect(lds.map((d) => d.executionTarget)).toEqual(['redmi', 'fire'])
  })

  it('an input (a pedal on the Fire\'s USB) runs where the matrix takes it in', () => {
    const map = withKemper()
    map.setups[0]!.routing['device:fire'] = [{ from: { kind: 'port', portId: 'usb' }, to: { kind: 'virtual', virtualPortId: 'ld-pedal' } }]
    expect(mapRoute(map, 'ld-pedal')).toEqual({ app: 'fire', midiName: null })
  })

  it('practising by another setup (#799 step 4): its matrix and its cable decide, not the active one', () => {
    const map = withKemper()
    map.setups.push({ id: 'home', name: 'Zuhause', owner: 'marco', positions: { 'device:fire': { x: 0, y: 0 }, kemper: { x: 1, y: 0 } }, links: [{ id: 'usb', from: { equipmentId: 'device:fire', portId: 'usb' }, to: { equipmentId: 'kemper', portId: 'usb' }, signals: ['midi'], midiName: 'Kemper at home' }], routing: { 'device:fire': [{ from: { kind: 'virtual', virtualPortId: 'ld-kemper' }, to: { kind: 'port', portId: 'usb' } }] } })
    expect(mapRoute(map, 'ld-kemper')).toEqual({ app: null, midiName: null })
    expect(mapRoute(map, 'ld-kemper', {}, 'home')).toEqual({ app: 'fire', midiName: 'Kemper at home' })
    const stored = [{ id: 'ld-kemper', capability: 'kemper-control', executionTarget: 'redmi' }, { id: 'ld-lights', capability: 'lighting', executionTarget: 'server' }]
    expect(routedLogicalDevices(stored, map, {}, 'home').map((d) => d.executionTarget)).toEqual(['fire', null])
  })

  it('routed nowhere: nobody sends; no map: the stored binding', () => {
    expect(mapRoute(withKemper(), 'ld-kemper')).toEqual({ app: null, midiName: null })
    const stored = [{ id: 'ld-kemper', capability: 'kemper-control', executionTarget: 'fire' }]
    expect(routedLogicalDevices(stored, { equipment: [], setups: [] })).toEqual(stored)
  })
})

describe('port model 2 (docs/31 §7b, #739): pins, container ports, OSC', () => {
  const tablet = equipmentFrom(model('tablet'), 'redmi', 'Redmi', { deviceId: 'redmi' })
  const iface = equipmentFrom(model('audio-interface'), 'umc', 'UMC204HD')
  const mixer = equipmentFrom(model('mixer'), 'desk', 'Pult')
  const iem = equipmentFrom(model('iem-sender'), 'iem', 'In-Ear-Sender')
  const kai = equipmentFrom(model('person'), 'kai', 'Kai', { listener: { kind: 'profile', profileId: 'kai' } })

  it('the schema takes pins, parts and the signal osc; stereo stays readable', () => {
    expect(PortSchema.safeParse({ id: 'p', name: 'Kopfhörer', connector: 'jack-3.5', signals: ['audio'], direction: 'out', pins: 2 }).success).toBe(true)
    expect(PortSchema.safeParse({ id: 'net', name: 'LAN', connector: 'ethernet', signals: ['osc'], direction: 'out', parts: [{ id: 'net/osc', name: 'OSC', signals: ['osc'], direction: 'out' }] }).success).toBe(true)
    expect(PortSchema.safeParse({ id: 'p', name: 'Main', connector: 'xlr', signals: ['audio'], direction: 'out', stereo: true }).success).toBe(true)
  })

  it('a map from before #739 is read the new way: stereo → pins 2, a USB socket gets its parts, its cables and points stay', () => {
    const old: Port = { id: 'headphones', name: 'Kopfhörer', connector: 'jack-3.5', signals: ['audio'], direction: 'out', stereo: true }
    expect(normalizePort(old)).toEqual({ id: 'headphones', name: 'Kopfhörer', connector: 'jack-3.5', signals: ['audio'], direction: 'out', pins: 2 })
    const usb: Port = { id: 'usb', name: 'USB', connector: 'usb-b', signals: ['usb-audio', 'midi'], direction: 'both' }
    expect(normalizePort(usb).parts?.map((x) => x.id)).toEqual(['usb/audio-out', 'usb/audio-in', 'usb/midi-out', 'usb/midi-in'])
    expect(normalizePort({ ...usb, direction: 'in' }).parts?.map((x) => x.id)).toEqual(['usb/audio-in', 'usb/midi-in'])
    // A plain jack has no parts; a container that has parts keeps them.
    expect(normalizePort(portOf('mixer', 'main')).parts).toBeUndefined()
    expect(normalizeEquipment(tablet).ports.find((p) => p.id === 'usb')?.parts).toHaveLength(4)
    // The old interface model routed the whole container onto its outputs: a container point still matches every part.
    const oldIface = { ...iface, ports: [usb, { id: 'out12', name: 'Out 1/2', connector: 'jack-6.3' as const, signals: ['audio' as const], direction: 'out' as const }], routing: { mode: 'free' as const, default: [{ from: { kind: 'port' as const, portId: 'usb' }, to: { kind: 'port' as const, portId: 'out12' } }] } }
    const setup: StageSetup = { id: 's', name: 'S', positions: { redmi: { x: 0, y: 0 }, umc: { x: 0, y: 0 }, desk: { x: 0, y: 0 }, kai: { x: 0, y: 0 } }, routing: { redmi: [{ from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'usb/audio-out', channel: 1 } }] }, links: [
      { id: 'c1', from: { equipmentId: 'redmi', portId: 'usb' }, to: { equipmentId: 'umc', portId: 'usb' }, signals: ['usb-audio', 'midi'] },
      { id: 'c2', from: { equipmentId: 'umc', portId: 'out12' }, to: { equipmentId: 'kai', portId: 'ears' }, signals: ['audio'] },
    ] }
    const flows = signalFlows({ equipment: [normalizeEquipment(tablet), normalizeEquipment(oldIface), kai], setups: [setup] }, 's', VIRTUAL)
    expect(flows.find((f) => f.key === 'redmi/track')?.listenerIds).toEqual(['kai'])
  })

  it('looks a part up through its container: the plug of the socket, the part\'s own signals and direction', () => {
    const view = lookupPort(tablet.ports, 'usb/audio-out')
    expect(view).toMatchObject({ id: 'usb/audio-out', connector: 'usb-c', signals: ['usb-audio'], direction: 'out', container: { id: 'usb' } })
    expect(cablePortId(tablet.ports, 'usb/audio-out')).toBe('usb')
    expect(cablePortId(tablet.ports, 'headphones')).toBe('headphones')
    expect(lookupPort(tablet.ports, 'headphones')?.pins).toBe(2)
  })

  it('slots: a stereo jack has two pins, a group its sockets; capacity counts from where a cable starts', () => {
    expect(portSlots(lookupPort(tablet.ports, 'headphones')!)).toEqual([{ pin: 1 }, { pin: 2 }])
    expect(portSlots(lookupPort(mixer.ports, 'aux')!)).toEqual([{ channel: 1 }, { channel: 2 }, { channel: 3 }, { channel: 4 }])
    expect(portCapacity(lookupPort(tablet.ports, 'headphones')!, undefined)).toBe(2)
    expect(portCapacity(lookupPort(tablet.ports, 'headphones')!, undefined, 2)).toBe(1)
    expect(portCapacity(lookupPort(mixer.ports, 'aux')!, 3)).toBe(2)
  })

  it("a tablet's USB audio has as many channels as the interface on the cable - none without a cable", () => {
    const setup: StageSetup = { id: 's', name: 'S', positions: { redmi: { x: 0, y: 0 }, umc: { x: 0, y: 0 } }, routing: {}, links: [{ id: 'c', from: { equipmentId: 'redmi', portId: 'usb' }, to: { equipmentId: 'umc', portId: 'usb' }, signals: ['usb-audio', 'midi'] }] }
    const four = { ...iface, ports: iface.ports.map((p) => (p.id === 'usb' ? { ...p, parts: p.parts!.map((x) => (x.id === 'usb/audio-in' ? { ...x, channels: 4 } : x)) } : p)) }
    const map: StageMap = { equipment: [tablet, four], setups: [setup] }
    expect(partChannels(map, setup, 'redmi', 'usb/audio-out')).toBe(4)
    expect(partChannels(map, setup, 'redmi', 'usb/audio-in')).toBe(2)
    expect(partChannels(map, setup, 'redmi', 'usb/midi-out')).toBeUndefined()
    expect(partChannels({ ...map, setups: [{ ...setup, links: [] }] }, { ...setup, links: [] }, 'redmi', 'usb/audio-out')).toBeUndefined()
  })

  it('Klick on USB audio out 1, Track on 3/4: one cable carries all of it, the interface puts channel 3 on its output 3', () => {
    const four = {
      ...iface,
      ports: [{ ...iface.ports[0]!, parts: iface.ports[0]!.parts!.map((x) => (x.id === 'usb/audio-in' ? { ...x, channels: 4 } : x)) }, { ...iface.ports[1]!, channels: 4 }],
      routing: { mode: 'free' as const, default: Array.from({ length: 4 }, (_, i) => ({ from: { kind: 'port' as const, portId: 'usb/audio-in', channel: i + 1 }, to: { kind: 'port' as const, portId: 'out', channel: i + 1 } })) },
    }
    const setup: StageSetup = {
      id: 's', name: 'S', positions: { redmi: { x: 0, y: 0 }, umc: { x: 0, y: 0 }, iem: { x: 0, y: 0 }, desk: { x: 0, y: 0 }, kai: { x: 0, y: 0 } },
      routing: { redmi: [
        { from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'usb/audio-out', channel: 1 } },
        { from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'usb/audio-out', channel: 3 } },
      ], desk: [{ from: { kind: 'port', portId: 'in', channel: 7 }, to: { kind: 'port', portId: 'main', channel: 1 } }] },
      links: [
        { id: 'usb', from: { equipmentId: 'redmi', portId: 'usb' }, to: { equipmentId: 'umc', portId: 'usb' }, signals: ['usb-audio', 'midi'] },
        { id: 'o1', from: { equipmentId: 'umc', portId: 'out', channel: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'] },
        { id: 'o3', from: { equipmentId: 'umc', portId: 'out', channel: 3 }, to: { equipmentId: 'desk', portId: 'in', channel: 7 }, signals: ['audio'] },
        { id: 'ear', from: { equipmentId: 'iem', portId: 'out' }, to: { equipmentId: 'kai', portId: 'ears' }, signals: ['audio'] },
      ],
    }
    const flows = signalFlows({ equipment: [tablet, four, iem, mixer, kai], setups: [setup] }, 's', VIRTUAL)
    const klick = flows.find((f) => f.key === 'redmi/klick')!
    expect(klick.hops.map((h) => h.linkId)).toEqual(['usb', 'o1', 'ear'])
    expect(klick.hops[0]).toMatchObject({ from: { portId: 'usb/audio-out', channel: 1 }, to: { portId: 'usb/audio-in', channel: 1 } })
    expect(klick.listenerIds).toEqual(['kai'])
    const track = flows.find((f) => f.key === 'redmi/track')!
    expect(track.hops.map((h) => h.linkId)).toEqual(['usb', 'o3'])
    expect(track.listenerIds).toEqual([])
    // The checks: the USB cable counts no channels, the outputs do.
    const { issues } = checkSetup({ equipment: [tablet, four, iem, mixer, kai], setups: [setup] }, 's')
    expect(issues).toEqual([])
  })

  it('a pin of the headphone jack: the left goes on the first channel of the in-ear sender, the right on the second', () => {
    const setup: StageSetup = {
      id: 's', name: 'S', positions: { redmi: { x: 0, y: 0 }, iem: { x: 0, y: 0 }, kai: { x: 0, y: 0 } },
      routing: { redmi: [
        { from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones', pin: 1 } },
        { from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'headphones', pin: 2 } },
      ] },
      links: [
        { id: 'y', from: { equipmentId: 'redmi', portId: 'headphones' }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'], width: 2 },
        { id: 'ear', from: { equipmentId: 'iem', portId: 'out' }, to: { equipmentId: 'kai', portId: 'ears' }, signals: ['audio'] },
      ],
    }
    const map: StageMap = { equipment: [tablet, iem, kai], setups: [setup] }
    const flows = signalFlows(map, 's', VIRTUAL)
    expect(flows.find((f) => f.key === 'redmi/klick')?.hops[0]).toMatchObject({ from: { portId: 'headphones', pin: 1 }, to: { portId: 'in', channel: 1 } })
    expect(flows.find((f) => f.key === 'redmi/track')?.hops[0]).toMatchObject({ from: { portId: 'headphones', pin: 2 }, to: { portId: 'in', channel: 2 } })
    // One mono cable from one pin on purpose: no "only one side of a stereo socket" warning (the
    // 3.5 mm plug into a combo socket needs an adapter, that stays).
    const kinds = (s: StageSetup) => checkSetup({ ...map, setups: [s] }, 's').issues.map((i) => i.kind).filter((k) => k !== 'adapter')
    const mono: StageSetup = { ...setup, links: [{ id: 'm', from: { equipmentId: 'redmi', portId: 'headphones', pin: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'] }] }
    expect(kinds(mono)).toEqual([])
    const whole: StageSetup = { ...setup, links: [{ id: 'm', from: { equipmentId: 'redmi', portId: 'headphones' }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'] }] }
    // A mono plug in the whole stereo output shorts the right channel: red (#746).
    expect(kinds(whole)).toEqual(['mono-in-stereo-out'])
    // Two mono cables on the same pin: double; on different pins: fine.
    const twice: StageSetup = { ...mono, links: [...mono.links, { id: 'm2', from: { equipmentId: 'redmi', portId: 'headphones', pin: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 2 }, signals: ['audio'] }] }
    expect(kinds(twice)).toEqual(['double'])
    const both: StageSetup = { ...mono, links: [...mono.links, { id: 'm2', from: { equipmentId: 'redmi', portId: 'headphones', pin: 2 }, to: { equipmentId: 'iem', portId: 'in', channel: 2 }, signals: ['audio'] }] }
    expect(kinds(both)).toEqual([])
    // A point on a pin the socket no longer has goes when the ports change.
    const pruned = pruneForPorts(setup, 'redmi', tablet.ports.map((p) => (p.id === 'headphones' ? { ...p, pins: 1 } : p)))
    expect(pruned.crosspoints).toBe(1)
  })

  it('mapRoute finds the cable on the container of a part', () => {
    const setup: StageSetup = { id: DEFAULT_SETUP_ID, name: 'Standard', positions: { redmi: { x: 0, y: 0 }, umc: { x: 0, y: 0 } }, routing: { redmi: [{ from: { kind: 'virtual', virtualPortId: 'kemper' }, to: { kind: 'port', portId: 'usb/midi-out' } }] }, links: [{ id: 'c', from: { equipmentId: 'redmi', portId: 'usb' }, to: { equipmentId: 'umc', portId: 'usb' }, signals: ['usb-audio', 'midi'], midiName: 'UMC204HD MIDI' }] }
    expect(mapRoute({ equipment: [tablet, iface], setups: [setup] }, 'kemper')).toEqual({ app: 'redmi', midiName: 'UMC204HD MIDI' })
  })
})

describe('own setups per person (#799, docs/31 §0d)', () => {
  const map = defaultStageMap([
    { id: 'redmi', name: 'Redmi' },
    { id: 'fire', name: 'Fire' },
  ])
  const band = map.setups[0]!

  it('starts from the member\'s own device with its listener, nothing of the others', () => {
    const home = ownSetupFrom(map, band, 'marco', ['device:redmi'], 'home', 'Home')
    expect(home.owner).toBe('marco')
    expect(Object.keys(home.positions)).toContain('device:redmi')
    expect(Object.keys(home.positions)).not.toContain('device:fire')
    expect(home.links.length).toBeGreaterThan(0)
    expect(home.links.every((l) => [l.from.equipmentId, l.to.equipmentId].includes('device:redmi'))).toBe(true)
    // The device plays by it: the sound follows the map there, too.
    expect(mapOutputs({ ...map, setups: [band, home] }, 'redmi', CAPABILITIES.clickTrack, {}, 'home')).toEqual([{ portId: 'speaker', route: 'any', side: 'both' }])
  })

  it('is seen by its owner and the admin only', () => {
    const home = ownSetupFrom(map, band, 'marco', ['device:redmi'], 'home', 'Home')
    const all = [band, home]
    expect(visibleOwnSetups(all, 'marco', false)).toEqual([home])
    expect(visibleOwnSetups(all, 'caro', false)).toEqual([])
    expect(visibleOwnSetups(all, 'caro', true)).toEqual([home])
    expect(visibleOwnSetups(all, '', false)).toEqual([])
  })

  it('offers own equipment only in its owner\'s setups', () => {
    const unit = { ...equipmentFrom(BUILTIN_MODELS.find((m) => m.kind === 'mixer')!, 'unit', 'Effects unit'), owner: 'marco' }
    const equipment = [...map.equipment, unit]
    expect(equipmentOffered(equipment, band)).not.toContain(unit)
    expect(equipmentOffered(equipment, { owner: 'caro' })).not.toContain(unit)
    expect(equipmentOffered(equipment, { owner: 'marco' })).toContain(unit)
  })
})

describe('cable checker: the whole chain (#746, docs/31 §7d)', () => {
  const tablet = equipmentFrom(model('tablet'), 'redmi', 'Redmi', { deviceId: 'redmi' })
  const iface = equipmentFrom(model('audio-interface'), 'umc', 'UMC204HD')
  const mixer = equipmentFrom(model('mixer'), 'desk', 'Pult')
  const iem = equipmentFrom(model('iem-sender'), 'iem', 'In-Ear-Sender')
  const kai = equipmentFrom(model('person'), 'kai', 'Kai', { listener: { kind: 'profile', profileId: 'kai' } })
  const at = { x: 0, y: 0 }
  const positions = { redmi: at, umc: at, desk: at, iem: at, kai: at }
  const ear: StageLink = { id: 'ear', from: { equipmentId: 'iem', portId: 'out' }, to: { equipmentId: 'kai', portId: 'ears' }, signals: ['audio'] }
  const kinds = (equipment: StageMap['equipment'], setup: StageSetup) => checkSetup({ equipment, setups: [setup] }, 's').issues.filter((i) => i.kind !== 'adapter')

  it('a stereo track on the whole headphone jack with one mono cable from the left pin: the right channel is lost', () => {
    const setup: StageSetup = {
      id: 's', name: 'S', positions,
      routing: { redmi: [{ from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'headphones' } }] },
      links: [{ id: 'm', from: { equipmentId: 'redmi', portId: 'headphones', pin: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'] }, ear],
    }
    expect(kinds([tablet, iem, kai], setup)).toEqual([{ kind: 'channel-lost', equipmentId: 'redmi', portId: 'headphones', pin: 2, virtualPortId: 'track' }])
    // A stereo cable carries both sides; so does mixing down onto the one pin in the matrix.
    const stereo: StageSetup = { ...setup, links: [{ id: 'y', from: { equipmentId: 'redmi', portId: 'headphones' }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'], width: 2 }, ear] }
    expect(kinds([tablet, iem, kai], stereo)).toEqual([])
    const mixedDown: StageSetup = { ...setup, routing: { redmi: [{ from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'headphones', pin: 1 } }] } }
    expect(kinds([tablet, iem, kai], mixedDown)).toEqual([])
    // The mono click has no second side to lose; nothing cabled at all is no finding either.
    const click: StageSetup = { ...setup, routing: { redmi: [{ from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones' } }] } }
    expect(kinds([tablet, iem, kai], click)).toEqual([])
    expect(kinds([tablet, iem, kai], { ...setup, links: [] })).toEqual([])
  })

  it('follows the chain through a matrix: both sides reach the desk, the desk passes only one on', () => {
    const setup: StageSetup = {
      id: 's', name: 'S', positions,
      routing: {
        redmi: [{ from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'headphones' } }],
        desk: [{ from: { kind: 'port', portId: 'in', channel: 1 }, to: { kind: 'port', portId: 'aux', channel: 1 } }],
      },
      links: [
        { id: 'y', from: { equipmentId: 'redmi', portId: 'headphones' }, to: { equipmentId: 'desk', portId: 'in', channel: 1 }, signals: ['audio'], width: 2 },
        { id: 'a', from: { equipmentId: 'desk', portId: 'aux', channel: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'] },
        ear,
      ],
    }
    expect(kinds([tablet, mixer, iem, kai], setup)).toEqual([{ kind: 'channel-lost', equipmentId: 'redmi', portId: 'headphones', pin: 2, virtualPortId: 'track' }])
    // The desk mixes: both inputs on the one aux and nothing is lost.
    const both: StageSetup = { ...setup, routing: { ...setup.routing, desk: [...setup.routing.desk!, { from: { kind: 'port', portId: 'in', channel: 2 }, to: { kind: 'port', portId: 'aux', channel: 1 } }] } }
    expect(kinds([tablet, mixer, iem, kai], both)).toEqual([])
  })

  it('a cable on one pin carries that pin only', () => {
    const setup: StageSetup = {
      id: 's', name: 'S', positions,
      routing: { redmi: [
        { from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones', pin: 1 } },
        { from: { kind: 'virtual', virtualPortId: 'track' }, to: { kind: 'port', portId: 'headphones', pin: 2 } },
      ] },
      links: [
        { id: 'l', from: { equipmentId: 'redmi', portId: 'headphones', pin: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 1 }, signals: ['audio'] },
        { id: 'r', from: { equipmentId: 'redmi', portId: 'headphones', pin: 2 }, to: { equipmentId: 'iem', portId: 'in', channel: 2 }, signals: ['audio'] },
      ],
    }
    const flows = signalFlows({ equipment: [tablet, iem, kai], setups: [setup] }, 's', VIRTUAL)
    expect(flows.find((f) => f.key === 'redmi/klick')?.hops).toEqual([{ linkId: 'l', from: { equipmentId: 'redmi', portId: 'headphones', pin: 1 }, to: { equipmentId: 'iem', portId: 'in', channel: 1 } }])
    expect(flows.find((f) => f.key === 'redmi/track')?.hops).toEqual([{ linkId: 'r', from: { equipmentId: 'redmi', portId: 'headphones', pin: 2 }, to: { equipmentId: 'iem', portId: 'in', channel: 2 } }])
  })

  it('a mono plug in a stereo output is red, at a stereo input it stays a warning', () => {
    const stereoIn = { ...mixer, ports: [...mixer.ports, { id: 'st', name: 'Stereo In', connector: 'jack-6.3' as const, signals: ['audio' as const], direction: 'in' as const, pins: 2 }] }
    const setup: StageSetup = {
      id: 's', name: 'S', positions, routing: {},
      links: [{ id: 'm', from: { equipmentId: 'redmi', portId: 'headphones' }, to: { equipmentId: 'desk', portId: 'st' }, signals: ['audio'] }],
    }
    expect(kinds([tablet, stereoIn], setup)).toEqual([
      { kind: 'mono-in-stereo-out', linkId: 'm', equipmentId: 'redmi', portId: 'headphones' },
      { kind: 'mono-of-stereo', linkId: 'm', equipmentId: 'desk', portId: 'st' },
    ])
  })

  it('two signals on one output of a device that does not mix: red; a mixer and the app mix', () => {
    const two: Crosspoint[] = [
      { from: { kind: 'port', portId: 'usb/audio-in', channel: 1 }, to: { kind: 'port', portId: 'out', channel: 1 } },
      { from: { kind: 'port', portId: 'usb/audio-in', channel: 2 }, to: { kind: 'port', portId: 'out', channel: 1 } },
    ]
    const setup: StageSetup = {
      id: 's', name: 'S', positions, links: [],
      routing: {
        umc: two,
        desk: [{ from: { kind: 'port', portId: 'in', channel: 1 }, to: { kind: 'port', portId: 'main', channel: 1 } }, { from: { kind: 'port', portId: 'in', channel: 2 }, to: { kind: 'port', portId: 'main', channel: 1 } }],
        redmi: [{ from: { kind: 'virtual', virtualPortId: 'klick' }, to: { kind: 'port', portId: 'headphones', pin: 1 } }, { from: { kind: 'virtual', virtualPortId: 'ansagen' }, to: { kind: 'port', portId: 'headphones', pin: 1 } }],
      },
    }
    expect(kinds([tablet, iface, mixer], setup)).toEqual([{ kind: 'mix', equipmentId: 'umc', portId: 'out', channel: 1, sources: 2 }])
    // The model's default (1:1) is fine; a model may say it mixes; the in-ear sender's fixed L/R is its own.
    expect(kinds([tablet, iface, mixer, iem], { ...setup, routing: {} })).toEqual([])
    expect(kinds([tablet, { ...iface, mixes: true }, mixer], setup)).toEqual([])
    expect(equipmentMixes(tablet)).toBe(true)
    expect(equipmentMixes(iface)).toBe(false)
    expect(equipmentFrom({ ...model('audio-interface'), mixes: true }, 'x', 'X').mixes).toBe(true)
  })
})

describe('hum loops (#748, docs/31 §7e)', () => {
  const at = { x: 0, y: 0 }
  const laptop = { ...equipmentFrom(model('tablet'), 'laptop', 'Laptop', { deviceId: 'laptop' }), earth: 'earthed' as const }
  const iface = equipmentFrom(model('audio-interface'), 'umc', 'UMC204HD')
  const desk = equipmentFrom(model('mixer'), 'desk', 'Pult')
  const di = equipmentFrom(model('di-box'), 'di', 'DI-Box')
  // The Kemper's own model (as its add-on describes it) has XLR outputs.
  const kemper = { ...equipmentFrom(model('amp-modeller'), 'kemper', 'Kemper'), ports: [...equipmentFrom(model('amp-modeller'), 'k', 'K').ports.filter((p) => p.id !== 'main'), { id: 'main', name: 'Main Out', connector: 'xlr' as const, signals: ['audio' as const], direction: 'out' as const }] }
  const link = (id: string, from: [string, string], to: [string, string], extra: Partial<StageLink> = {}): StageLink => ({ id, from: { equipmentId: from[0], portId: from[1] }, to: { equipmentId: to[0], portId: to[1], ...(to[0] === 'desk' ? { channel: 1 } : {}) }, signals: ['audio'], ...extra })
  const run = (equipment: StageMap['equipment'], links: StageLink[]) => {
    const setup: StageSetup = { id: 's', name: 'S', positions: Object.fromEntries(equipment.map((e) => [e.id, at])), links, routing: {} }
    return checkSetup({ equipment, setups: [setup] }, 's').issues.filter((i) => i.kind === 'hum-loop' || i.kind === 'hum-hint')
  }
  const usb = link('usb', ['laptop', 'usb'], ['umc', 'usb'], { signals: ['usb-audio'] })

  it('power by kind: the desk earthed, a tablet on battery, an interface without earth; the map can say otherwise', () => {
    expect(equipmentEarth(desk)).toBe('earthed')
    expect(equipmentEarth(equipmentFrom(model('tablet'), 't', 'T'))).toBe('battery')
    expect(equipmentEarth(iface)).toBe('floating')
    expect(equipmentEarth(laptop)).toBe('earthed')
  })

  it('cables by their plugs: XLR and TRS balanced, TS and stereo jacks unbalanced, the cable can say otherwise, USB ties ground, MIDI isolated', () => {
    const port = (connector: Port['connector'], pins?: number): Port => ({ id: 'p', name: 'P', connector, signals: ['audio'], direction: 'out', ...(pins ? { pins } : {}) })
    expect(cableGround(port('xlr'), port('xlr-jack'))).toBe('balanced')
    expect(cableGround(port('jack-6.3'), port('xlr-jack'))).toBe('balanced')
    expect(cableGround(port('jack-6.3-ts'), port('xlr-jack'))).toBe('unbalanced')
    expect(cableGround(port('jack-6.3', 2), port('jack-6.3'))).toBe('unbalanced')
    expect(cableGround(port('jack-6.3'), port('xlr-jack'), 'unbalanced')).toBe('unbalanced')
    expect(cableGround(port('usb-c'), port('usb-b'))).toBe('ground')
    expect(cableGround(port('din5'), port('din5'))).toBe('isolated')
    expect(cableGround(port('jack-3.5', 2), port('wireless'))).toBe('isolated')
  })

  it('laptop on its charger → USB → interface → mono jack → desk: red; with a DI box in between: gone (acceptance)', () => {
    // The interface's outputs are TRS sockets; the mono cable in it is said on the cable.
    const jack = link('jack', ['umc', 'out'], ['desk', 'in'], { ground: 'unbalanced' })
    expect(run([laptop, iface, desk], [usb, jack])).toEqual([{ kind: 'hum-loop', equipmentIds: ['laptop', 'desk'], linkIds: ['jack'] }])
    const viaDi = [usb, link('j1', ['umc', 'out'], ['di', 'in']), link('x1', ['di', 'out'], ['desk', 'in'])]
    expect(run([laptop, iface, di, desk], viaDi)).toEqual([])
    // The same laptop on its battery closes no loop.
    expect(run([{ ...laptop, earth: 'battery' }, iface, desk], [usb, jack])).toEqual([])
    // A balanced TRS cable instead (the socket's own default): only the USB ground is left - a quiet hint.
    const { ground: _mono, ...trs } = jack
    expect(run([laptop, iface, desk], [usb, trs])).toEqual([{ kind: 'hum-hint', equipmentIds: ['laptop', 'desk'], linkIds: ['usb'] }])
    // An isolator in the cable stops it as well.
    expect(run([laptop, iface, desk], [usb, { ...jack, ground: 'isolated' }])).toEqual([])
  })

  it('Kemper → XLR → desk: not red (acceptance); a tablet bridging two earthed devices with a headphone cable is', () => {
    expect(run([kemper, desk], [link('x', ['kemper', 'main'], ['desk', 'in'])])).toEqual([])
    const tablet = equipmentFrom(model('tablet'), 'redmi', 'Redmi', { deviceId: 'redmi' })
    const links = [link('x', ['kemper', 'main'], ['desk', 'in']), link('k', ['redmi', 'usb'], ['kemper', 'usb'], { signals: ['midi'] }), link('h', ['redmi', 'headphones'], ['desk', 'in'], { to: { equipmentId: 'desk', portId: 'in', channel: 2 } })]
    // Kemper and desk already meet over XLR; the tablet adds USB + its headphone jack: the jack is the culprit.
    expect(run([kemper, desk, tablet], links)).toEqual([{ kind: 'hum-loop', equipmentIds: ['kemper', 'desk'], linkIds: ['h'] }])
  })
})

describe('a tablet takes its ports from its model (2026-11-12)', () => {
  it('a copy stored before #739 (mono headphones) reads as the model has it; other gear keeps its own', () => {
    const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
    const tablet = map.equipment.find((e) => e.kind === 'stageboard')!
    const old = { ...tablet, ports: tablet.ports.map((p) => (p.id === 'headphones' ? { id: p.id, name: p.name, connector: p.connector, signals: p.signals, direction: p.direction } : p)) }
    expect(old.ports.find((p) => p.id === 'headphones')!.pins).toBeUndefined()
    expect(normalizeEquipment(old).ports.find((p) => p.id === 'headphones')!.pins).toBe(2)
    // Gear that can be set up keeps what was set up, even on the same model id.
    const gear = { ...old, kind: 'mixer' as const }
    expect(normalizeEquipment(gear).ports.find((p) => p.id === 'headphones')!.pins).toBeUndefined()
  })
})

describe('the Behringer UMC204HD in detail (2026-11-12)', () => {
  it('playback 1/2 on Main Out, Playback A and the Phones, 3/4 on Playback B; the inputs to the host; MIDI through', () => {
    const umc = BUILTIN_MODELS.find((m) => m.id === 'behringer-umc204hd')!
    expect(umc.kind).toBe('audio-interface')
    expect(umc.routing?.mode).toBe('fixed')
    const to = (portId: string, channel?: number) =>
      umc.routing!.default.filter((c) => c.from.kind === 'port' && c.from.portId === portId && c.from.channel === channel).map((c) => (c.to.kind === 'port' ? `${c.to.portId}${c.to.channel ?? ''}${c.to.pin ? `.${c.to.pin}` : ''}` : ''))
    expect(to('usb/audio-in', 1)).toEqual(['main1', 'playback-a1', 'phones.1'])
    expect(to('usb/audio-in', 4)).toEqual(['playback-b2'])
    expect(to('in', 2)).toEqual(['usb/audio-out2'])
    expect(to('usb/midi-in')).toEqual(['midi-out'])
    // Every point names a port the model has.
    const ids = new Set(umc.ports.flatMap((p) => [p.id, ...(p.parts ?? []).map((x) => x.id)]))
    for (const c of umc.routing!.default) for (const end of [c.from, c.to]) expect(end.kind === 'port' && ids.has(end.portId)).toBe(true)
  })
})


describe('the NUX MG-30 in detail (2026-11-12)', () => {
  it('the guitar through the FX loop to Main Out, the Phones and the host; MIDI only over USB', () => {
    const mg = BUILTIN_MODELS.find((m) => m.id === 'nux-mg30')!
    expect(mg.kind).toBe('amp-modeller')
    expect(mg.routing?.mode).toBe('fixed')
    const to = (portId: string, channel?: number) =>
      mg.routing!.default.filter((c) => c.from.kind === 'port' && c.from.portId === portId && c.from.channel === channel && c.from.pin === undefined).map((c) => (c.to.kind === 'port' ? `${c.to.portId}${c.to.channel ?? ''}${c.to.pin ? `.${c.to.pin}` : ''}` : ''))
    expect(to('in')).toEqual(['send', 'main1', 'main2', 'phones.1', 'phones.2', 'usb/audio-out1', 'usb/audio-out2'])
    expect(to('usb/audio-in', 2)).toEqual(['main2', 'phones.2'])
    expect(to('usb/midi-in')).toEqual(['main1'])
    expect(mg.ports.some((p) => p.connector === 'din5')).toBe(false)
    // A wall wart, no earth: no hum loop of its own (device test 2026-11-12).
    expect(equipmentEarth(equipmentFrom(mg, 'mg', 'MG-30'))).toBe('floating')
    const ids = new Set(mg.ports.flatMap((p) => [p.id, ...(p.parts ?? []).map((x) => x.id)]))
    for (const c of mg.routing!.default) for (const end of [c.from, c.to]) expect(end.kind === 'port' && ids.has(end.portId)).toBe(true)
  })
})
