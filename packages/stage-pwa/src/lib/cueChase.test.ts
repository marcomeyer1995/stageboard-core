import { describe, expect, it } from 'vitest'
import type { ShowCue } from 'shared-types'
import { KEMPER_CAPABILITY } from './midiDeviceProtocols'
import { chaseCues } from './cueChase'

const rig = (id: string, timeMs: number, performance: number): ShowCue => ({ id, timeMs, targetLogicalDeviceId: 'kemper', type: 'kemper.selectRig', payload: { performance, slot: 1 } })
const capabilityOf = () => KEMPER_CAPABILITY

describe('chaseCues (#479)', () => {
  // Verse 0-16 s on rig 1 (set at 0), chorus 16-32 s on rig 2 (set at 16), solo 32 s on rig 3.
  const cues = [rig('r1', 0, 1), rig('r2', 16_000, 2), rig('r3', 32_000, 3)]

  it('jumping back from the solo to the verse sends the verse rig', () => {
    // At 40 s (solo, rig 3) back to 8 s (verse): rig 1 again.
    expect(chaseCues(cues, 40_000, 8_000, capabilityOf).map((c) => c.id)).toEqual(['r1'])
  })

  it('looping the chorus sends nothing - same rig', () => {
    expect(chaseCues(cues, 32_000, 16_000, capabilityOf)).toEqual([])
  })

  it('a rig the target sets on its first moment is left to that cue', () => {
    // From the verse (rig 1) to the chorus start: r2 sits exactly on the target and fires anyway.
    expect(chaseCues(cues, 12_000, 16_000, capabilityOf)).toEqual([])
  })

  it('one-off events are never repeated', () => {
    const extend: ShowCue = { id: 'x', timeMs: 4_000, targetLogicalDeviceId: 'click', type: 'click.extend', payload: { bars: 2 } }
    expect(chaseCues([...cues, extend], 40_000, 8_000, (c) => (c.type === 'click.extend' ? 'click-track' : KEMPER_CAPABILITY)).map((c) => c.id)).toEqual(['r1'])
  })
})
