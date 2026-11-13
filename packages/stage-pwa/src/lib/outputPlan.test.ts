import { describe, expect, it } from 'vitest'
import { defaultStageMap, type StageMap } from 'shared-types'
import { outputPlan, practiceRoute, silencedSources, type PlanInput } from './outputPlan'

const to = (virtualPortId: string, portId: string, pin?: number) => ({ from: { kind: 'virtual' as const, virtualPortId }, to: pin === undefined ? { kind: 'port' as const, portId } : { kind: 'port' as const, portId, pin } })

function split(): StageMap {
  const map = defaultStageMap([{ id: 'redmi', name: 'Redmi' }])
  map.setups[0]!.routing['device:redmi'] = [to('klick', 'headphones', 1), to('ansagen', 'headphones', 1), to('track', 'usb/audio-out')]
  return map
}
const input = (over: Partial<PlanInput>): PlanInput => ({ mode: 'gig', map: split(), deviceId: 'redmi', front: {}, route: 'wired', practiceSetupId: null, ...over })

describe('the output plan (#742, docs/31 §0d)', () => {
  it('no map, or the untouched default map: everything on both sides', () => {
    expect(outputPlan(input({ map: null })).plan).toEqual({ track: 'both', click: 'both', voice: 'both' })
    expect(outputPlan(input({ map: defaultStageMap([{ id: 'redmi', name: 'Redmi' }]), route: 'bluetooth' })).plan).toEqual({ track: 'both', click: 'both', voice: 'both' })
  })

  it('Gig: only the source whose output is missing goes silent', () => {
    // On the headphones: the click plays left, the track (routed to USB) stays silent.
    const wired = outputPlan(input({})).plan
    expect(wired).toEqual({ click: 'left', voice: 'left', track: null })
    expect(silencedSources(wired)).toEqual(['track'])
    // On the interface: the other way round.
    expect(outputPlan(input({ route: 'usb' })).plan).toEqual({ click: null, voice: null, track: 'both' })
  })

  it('practice: both ears unless a setup is chosen; a setup that cannot apply falls back', () => {
    expect(outputPlan(input({ mode: 'practice' }))).toEqual({ plan: { track: 'both', click: 'both', voice: 'both' }, fellBack: false })
    // The track's output (USB) is missing on the headphones: everything back on both ears.
    expect(outputPlan(input({ mode: 'practice', practiceSetupId: 'standard' }))).toEqual({ plan: { track: 'both', click: 'both', voice: 'both' }, fellBack: true })
    expect(outputPlan(input({ mode: 'practice', practiceSetupId: 'gone' })).fellBack).toBe(true)
    const map = split()
    map.setups[0]!.routing['device:redmi'] = [to('klick', 'headphones', 1), to('track', 'headphones', 2)]
    // Announcements are routed nowhere in that setup: they stay on both ears while practising.
    expect(outputPlan(input({ mode: 'practice', practiceSetupId: 'standard', map }))).toEqual({ plan: { click: 'left', track: 'right', voice: 'both' }, fellBack: false })
  })

  it('practice by an own setup (#799): the sides come from this device\'s matrix there', () => {
    const map = split()
    map.setups.push({ id: 'home', name: 'Home', owner: 'marco', positions: { 'device:redmi': { x: 0, y: 0 } }, links: [], routing: { 'device:redmi': [to('klick', 'headphones', 1), to('track', 'headphones', 2)] } })
    expect(outputPlan(input({ mode: 'practice', map, practiceSetupId: 'home' }))).toEqual({ plan: { click: 'left', track: 'right', voice: 'both' }, fellBack: false })
    // Not offered to this device (another person's, or the Gig): gone from the map - both ears.
    expect(outputPlan(input({ mode: 'practice', practiceSetupId: 'home' }))).toEqual({ plan: { track: 'both', click: 'both', voice: 'both' }, fellBack: true })
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
})
