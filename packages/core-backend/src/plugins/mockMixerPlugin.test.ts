import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from 'shared-types'
import { createMockMixerPlugin } from './mockMixerPlugin.js'

function testContext(): PluginContext {
  return { log: { info: vi.fn(), error: vi.fn() } }
}

describe('mockMixerPlugin', () => {
  it('starts with no channel volumes set', () => {
    const plugin = createMockMixerPlugin()
    plugin.init(testContext())
    expect(plugin.trigger({ type: 'anything' })).toEqual({ status: 'ok', data: { volumes: {} } })
  })

  it('sets one channel volume without touching others', () => {
    const plugin = createMockMixerPlugin()
    plugin.init(testContext())
    plugin.trigger({ type: 'set_volume', payload: { channel: 'Mein Gesang', volume: 70 } })
    const result = plugin.trigger({ type: 'set_volume', payload: { channel: 'Band', volume: 40 } })
    expect(result).toEqual({ status: 'ok', data: { volumes: { 'Mein Gesang': 70, Band: 40 } } })
  })

  it('overwrites a channel already set', () => {
    const plugin = createMockMixerPlugin()
    plugin.init(testContext())
    plugin.trigger({ type: 'set_volume', payload: { channel: 'Band', volume: 40 } })
    const result = plugin.trigger({ type: 'set_volume', payload: { channel: 'Band', volume: 85 } })
    expect(result).toEqual({ status: 'ok', data: { volumes: { Band: 85 } } })
  })

  it('ignores a set_volume event missing a valid channel or volume', () => {
    const plugin = createMockMixerPlugin()
    plugin.init(testContext())
    plugin.trigger({ type: 'set_volume', payload: { channel: 'Band', volume: 'loud' } })
    plugin.trigger({ type: 'set_volume', payload: { volume: 40 } })
    expect(plugin.trigger({ type: 'anything' })).toEqual({ status: 'ok', data: { volumes: {} } })
  })
})
