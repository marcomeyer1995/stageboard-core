import { describe, expect, it } from 'vitest'
import { defaultStageMap, type StageMap } from 'shared-types'
import { outputPlan, practiceRoute, silencedSources, type PlanInput } from './outputPlan'

const BOTH = { left: 'L', right: 'R' }
const LEFT = { left: 'mix', right: null }
const RIGHT = { left: null, right: 'mix' }

const to = (virtualPortId: string, portId: string, pin?: number) => ({ from: { kind: 'virtual' as const, virtualPortId }, to: pin === undefined ? { kind: 'port' as const, portId } : { kind: 'port' as const, portId, pin } })

function split(): StageMap {
  const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
  map.setups[0]!.routing['device:redmi'] = [to('klick', 'headphones', 1), to('ansagen', 'headphones', 1), to('track', 'usb/audio-out')]
  return map
}
const input = (over: Partial<PlanInput>): PlanInput => ({ mode: 'gig', map: split(), deviceId: 'redmi', front: {}, route: 'wired', practiceSetupId: null, ...over })

describe('the output plan (#742, docs/31 §0d)', () => {
  it('no map, or the untouched default map: everything on both sides', () => {
    expect(outputPlan(input({ map: null })).plan).toEqual({ track: BOTH, click: BOTH, voice: BOTH })
    expect(outputPlan(input({ map: defaultStageMap([{ id: 'redmi', name: 'Redmi' }]), route: 'bluetooth' })).plan).toEqual({ track: BOTH, click: BOTH, voice: BOTH })
  })

  it('Gig: only the source whose output is missing goes silent', () => {
    // On the headphones: the click plays left, the track (routed to USB) stays silent.
    const wired = outputPlan(input({})).plan
    expect(wired).toEqual({ click: LEFT, voice: LEFT, track: null })
    expect(silencedSources(wired)).toEqual(['track'])
    // On the interface: the other way round.
    expect(outputPlan(input({ route: 'usb' })).plan).toEqual({ click: null, voice: null, track: BOTH })
  })

  it('practice: both ears unless a setup is chosen; a setup that cannot apply falls back', () => {
    expect(outputPlan(input({ mode: 'practice' }))).toEqual({ plan: { track: BOTH, click: BOTH, voice: BOTH }, fellBack: false })
    // The track's output (USB) is missing on the headphones: everything back on both ears.
    expect(outputPlan(input({ mode: 'practice', practiceSetupId: 'standard' }))).toEqual({ plan: { track: BOTH, click: BOTH, voice: BOTH }, fellBack: true })
    expect(outputPlan(input({ mode: 'practice', practiceSetupId: 'gone' })).fellBack).toBe(true)
    const map = split()
    map.setups[0]!.routing['device:redmi'] = [to('klick', 'headphones', 1), to('track', 'headphones', 2)]
    // Announcements are routed nowhere in that setup: they stay on both ears while practising.
    expect(outputPlan(input({ mode: 'practice', practiceSetupId: 'standard', map }))).toEqual({ plan: { click: LEFT, track: RIGHT, voice: BOTH }, fellBack: false })
  })

  it('practice by an own setup (#799): the sides come from this device\'s matrix there', () => {
    const map = split()
    map.setups.push({ id: 'home', name: 'Home', owner: 'marco', positions: { 'device:redmi': { x: 0, y: 0 } }, links: [], routing: { 'device:redmi': [to('klick', 'headphones', 1), to('track', 'headphones', 2)] } })
    expect(outputPlan(input({ mode: 'practice', map, practiceSetupId: 'home' }))).toEqual({ plan: { click: LEFT, track: RIGHT, voice: BOTH }, fellBack: false })
    // Not offered to this device (another person's, or the Gig): gone from the map - both ears.
    expect(outputPlan(input({ mode: 'practice', practiceSetupId: 'home' }))).toEqual({ plan: { track: BOTH, click: BOTH, voice: BOTH }, fellBack: true })
  })

  it('plugin devices go by the practice setup (#799 step 4): one of the band, or one of this person - never somebody else\'s', () => {
    const band = split()
    const home = { id: 'home', name: 'Home', owner: 'marco', positions: {}, links: [], routing: {} }
    const lists = { equipment: band.equipment, setups: band.setups, ownEquipment: [], ownSetups: [home] }
    expect(practiceRoute(lists, 'marco', null)).toBeNull()
    expect(practiceRoute(lists, 'marco', 'standard')?.setupId).toBe('standard')
    expect(practiceRoute(lists, 'marco', 'home')?.map.setups.map((s) => s.id)).toEqual(['standard', 'home'])
    expect(practiceRoute(lists, 'caro', 'home')).toBeNull()
    expect(practiceRoute(lists, '', 'home')).toBeNull()
  })

  it('the sides of the track alone (2026-11-12): "Track L" and "Track R" wherever they are put', () => {
    const side = (virtualPortId: string, channel: 1 | 2, portId: string, pin?: number) => ({ ...to(virtualPortId, portId, pin), from: { kind: 'virtual' as const, virtualPortId, channel } })
    const map = split()
    // Swapped on the headphones.
    map.setups[0]!.routing['device:redmi'] = [side('track', 1, 'headphones', 2), side('track', 2, 'headphones', 1)]
    expect(outputPlan(input({ map })).plan.track).toEqual({ left: 'R', right: 'L' })
    // Only its left side, on the whole socket: on both sides.
    map.setups[0]!.routing['device:redmi'] = [side('track', 1, 'headphones')]
    expect(outputPlan(input({ map })).plan.track).toEqual({ left: 'L', right: 'L' })
    // The whole track on both pins stays stereo; on one pin it is summed.
    map.setups[0]!.routing['device:redmi'] = [to('track', 'headphones', 1), to('track', 'headphones', 2), to('klick', 'headphones', 1)]
    expect(outputPlan(input({ map })).plan).toMatchObject({ track: BOTH, click: LEFT })
    map.setups[0]!.routing['device:redmi'] = [to('track', 'headphones', 2)]
    expect(outputPlan(input({ map })).plan.track).toEqual(RIGHT)
  })
})
