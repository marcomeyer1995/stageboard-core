import { describe, expect, it } from 'vitest'
import { defaultStageMap, type StageMap } from 'shared-types'
import { outputPlan, silencedSources, type PlanInput } from './outputPlan'

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
})
