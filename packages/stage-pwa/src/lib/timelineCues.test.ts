import { describe, expect, it } from 'vitest'
import type { ShowCue } from 'shared-types'
import { addCue, mergeCues, moveCue, parseCuePayload, removeCue, updateCue } from './timelineCues'

const cues: ShowCue[] = [
  { id: 'a', timeMs: 1000, targetLogicalDeviceId: 'kemper', type: 'kemper.selectRig', payload: { rig: 1 } },
  { id: 'b', timeMs: 5000, targetLogicalDeviceId: 'light', type: 'scene' },
]

describe('cue edits', () => {
  it('adds a cue in time order, never before 0:00', () => {
    const { cues: next, id } = addCue(cues, { timeMs: 3000.4, targetLogicalDeviceId: 'light', type: 'blackout' })
    expect(next.map((c) => c.timeMs)).toEqual([1000, 3000, 5000])
    expect(next.find((c) => c.id === id)?.type).toBe('blackout')
    expect(addCue(cues, { timeMs: -50, targetLogicalDeviceId: 'x', type: 't' }).cues[0]!.timeMs).toBe(0)
  })

  it('moves a cue and keeps the list sorted', () => {
    expect(moveCue(cues, 'a', 7000).map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('updates the content without touching the time, removes, merges', () => {
    expect(updateCue(cues, 'b', { type: 'blackout', payload: undefined })[1]).toEqual({ id: 'b', timeMs: 5000, targetLogicalDeviceId: 'light', type: 'blackout', payload: undefined })
    expect(removeCue(cues, 'a').map((c) => c.id)).toEqual(['b'])
    expect(mergeCues(cues, [{ id: 'r', timeMs: 2000, targetLogicalDeviceId: 'kemper', type: 'x' }]).map((c) => c.id)).toEqual(['a', 'r', 'b'])
  })
})

describe('parseCuePayload', () => {
  it('accepts nothing or a JSON object, explains anything else', () => {
    expect(parseCuePayload('  ')).toEqual({ payload: undefined })
    expect(parseCuePayload('{"slot": 3}')).toEqual({ payload: { slot: 3 } })
    expect(parseCuePayload('[1]')).toHaveProperty('error')
    expect(parseCuePayload('{slot')).toEqual({ error: 'Ungültiges JSON' })
  })
})
