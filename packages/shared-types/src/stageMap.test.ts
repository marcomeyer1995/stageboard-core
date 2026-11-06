import { describe, expect, it } from 'vitest'
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
    expect(effectiveRouting(map.equipment.find((e) => e.id === 'iem')!, setup)).toEqual([{ from: { kind: 'port', portId: 'in' }, to: { kind: 'port', portId: 'out' } }])
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
