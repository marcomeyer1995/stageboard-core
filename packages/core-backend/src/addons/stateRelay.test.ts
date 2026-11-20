import { describe, expect, it, vi } from 'vitest'
import type { StateField } from 'shared-types'
import { relayAddonState } from './stateRelay.js'

const declared: Record<string, StateField> = { lastCue: { type: 'string' } }
const setup = (workspaceId: string | null = 'band') => {
  const published: unknown[] = []
  const log = { error: vi.fn() }
  const channels = { publishDeviceState: vi.fn((ws: string, event: unknown, fields: Record<string, StateField>) => (published.push([ws, event, Object.keys(fields)]), { ok: true as const, devices: 1 })) }
  return { published, log, channels, run: (body: unknown) => relayAddonState({ channels, workspaceId, addonId: 'osc', body, declared, now: () => 42, log }) }
}

describe('an add-on\'s device state reaches the band only checked (#964, docs/36 §5a)', () => {
  it('stamps the time itself and hands the declared fields to the channel - the add-on says only device, key and value', () => {
    const t = setup()
    expect(t.run({ device: 'lights', key: 'lastCue', value: '/cue/1/go', at: 999999, extra: 'ignored' })).toBe(true)
    expect(t.published).toEqual([['band', { device: 'lights', key: 'lastCue', value: '/cue/1/go', at: 42 }, ['lastCue']]])
  })

  it('a message that is not {device, key, value} - or has a value that is no scalar - never reaches the channel, and is logged', () => {
    const t = setup()
    for (const bad of [null, 'x', [], {}, { device: 'l' }, { device: 'l', key: 'k' }, { device: 'l', key: 'k', value: { nested: 1 } }, { device: '', key: 'k', value: 1 }, { device: 'l', key: 'k', value: 'x'.repeat(501) }]) expect(t.run(bad), JSON.stringify(bad)).toBe(false)
    expect(t.channels.publishDeviceState).not.toHaveBeenCalled()
    expect(t.log.error).toHaveBeenCalledTimes(9)
  })

  it('says nothing when this host serves no band, and reports the channel\'s refusal of a value that does not fit', () => {
    expect(setup(null).run({ device: 'l', key: 'lastCue', value: 'x' })).toBe(false)
    const t = setup()
    t.channels.publishDeviceState.mockReturnValueOnce({ ok: false, reason: 'the add-on declared no state field "colour"' } as never)
    expect(t.run({ device: 'l', key: 'colour', value: 'red' })).toBe(false)
    expect(t.log.error).toHaveBeenCalledWith('add-on osc: state refused', { device: 'l', reason: expect.stringContaining('colour') })
  })
})
