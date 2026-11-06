import { describe, expect, it } from 'vitest'
import {
  addDeviceToMap,
  BUILTIN_MODELS,
  DEFAULT_SETUP_ID,
  defaultStageMap,
  equipmentFrom,
  portFit,
  StageMapSchema,
  stagePaths,
  type Port,
  type StageLink,
  type StageMap,
} from './stageMap.js'

const model = (id: string) => BUILTIN_MODELS.find((m) => m.id === id)!
const portOf = (modelId: string, portId: string): Port => model(modelId).ports.find((p) => p.id === portId)!

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

  it('every device plays Klick, Track and Ansagen on its own speaker for whoever is signed in there', () => {
    expect(StageMapSchema.parse(map)).toEqual(map)
    const paths = stagePaths(map, DEFAULT_SETUP_ID)
    expect(paths.map((p) => [p.start.from.equipmentId, p.start.from.portId, p.listenerIds, p.virtualPortIds])).toEqual([
      ['device:redmi', 'speaker', ['listener:redmi'], ['klick', 'track', 'ansagen']],
      ['device:fire', 'speaker', ['listener:fire'], ['klick', 'track', 'ansagen']],
    ])
    expect(map.equipment.find((e) => e.id === 'listener:fire')!.listener).toEqual({ kind: 'signed-in', deviceId: 'fire' })
  })

  it('a new device joins the same way, in every setup; one already on the map stays as the band left it', () => {
    const twoSetups: StageMap = { ...map, setups: [...map.setups, { id: 'club', name: 'Club', positions: {}, links: [], patch: [] }] }
    const more = addDeviceToMap(twoSetups, { id: 'phone', name: 'Handy' }, ['klick'])
    for (const setup of more.setups) expect(setup.patch.filter((p) => p.linkId === 'default:phone')).toEqual([{ virtualPortId: 'klick', linkId: 'default:phone' }])
    expect(addDeviceToMap(more, { id: 'phone', name: 'Handy' }, ['klick'])).toBe(more)
  })
})

describe('paths', () => {
  const link = (id: string, from: string, fp: string, to: string, tp: string, signals: StageLink['signals'], extra: Partial<StageLink> = {}): StageLink => ({
    id,
    from: { equipmentId: from, portId: fp },
    to: { equipmentId: to, portId: tp },
    signals,
    ...extra,
  })
  const club = (links: StageLink[]): StageMap => ({
    equipment: [
      equipmentFrom(model('tablet'), 'redmi', 'Redmi', { deviceId: 'redmi' }),
      equipmentFrom(model('amp-modeller'), 'kemper', 'Kemper'),
      equipmentFrom(model('mixer'), 'mixer', 'Pult'),
      equipmentFrom(model('iem-sender'), 'iem', 'In-Ear Kai'),
      equipmentFrom(model('person'), 'kai', 'Kai', { listener: { kind: 'profile', profileId: 'kai' } }),
      equipmentFrom(model('pa'), 'pa', 'PA'),
      equipmentFrom(model('hall'), 'hall', 'Saal'),
    ],
    setups: [{ id: 'club', name: 'Club', positions: {}, links, patch: [{ virtualPortId: 'klick', linkId: 'click' }] }],
  })
  const onward = [
    link('aux', 'mixer', 'aux', 'iem', 'in', ['audio'], { from: { equipmentId: 'mixer', portId: 'aux', channel: 1 } }),
    link('radio', 'iem', 'out', 'kai', 'ears', ['audio']),
    link('main', 'mixer', 'main', 'pa', 'in', ['audio']),
    link('room', 'pa', 'out', 'hall', 'ears', ['audio']),
  ]

  it('a mixer passes a signal only to the outputs ticked on its input - the click never reaches the hall by assumption', () => {
    const into = { from: { equipmentId: 'redmi', portId: 'headphones' }, to: { equipmentId: 'mixer', portId: 'in', channel: 15 } }
    const ticked = club([{ ...link('click', 'redmi', 'headphones', 'mixer', 'in', ['audio'], { routes: [{ portId: 'aux', channel: 1 }] }), ...into }, ...onward])
    const [path] = stagePaths(ticked, 'club')
    expect(path!.listenerIds).toEqual(['kai'])
    expect(path!.linkIds).toEqual(['click', 'aux', 'radio'])
    expect(path!.virtualPortIds).toEqual(['klick'])
    expect(path!.key).toBe('redmi.headphones>mixer.in#15:sound')

    const unticked = club([{ ...link('click', 'redmi', 'headphones', 'mixer', 'in', ['audio']), ...into }, ...onward])
    expect(stagePaths(unticked, 'club')[0]!.listenerIds).toEqual([])
  })

  it('gear that sounds carries a MIDI path on as sound; other gear passes everything', () => {
    const map = club([
      link('midi', 'redmi', 'usb', 'kemper', 'usb', ['midi']),
      link('amp', 'kemper', 'main', 'mixer', 'in', ['audio'], { to: { equipmentId: 'mixer', portId: 'in', channel: 3 }, routes: [{ portId: 'main' }] }),
      ...onward,
    ])
    const [path] = stagePaths(map, 'club')
    expect([path!.signalClass, path!.listenerIds, path!.linkIds]).toEqual(['midi', ['hall'], ['midi', 'amp', 'main', 'room']])
  })

  it('a USB cable to an interface is one path per signal class', () => {
    const map = club([link('usb', 'redmi', 'usb', 'mixer', 'in', ['usb-audio', 'midi'])])
    expect(stagePaths(map, 'club').map((p) => p.signalClass)).toEqual(['sound', 'midi'])
  })
})
