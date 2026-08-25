import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from 'shared-types'
import { createMockMixerPlugin } from './mockMixerPlugin.js'
import { PluginRegistry } from './registry.js'

function testContext(): PluginContext {
  return { log: { info: vi.fn(), error: vi.fn() } }
}

describe('PluginRegistry', () => {
  it('lists a registered plugin', async () => {
    const registry = new PluginRegistry()
    await registry.register(createMockMixerPlugin(), testContext())
    expect(registry.list()).toEqual([
      { name: 'mock-mixer', version: '0.0.1', capabilities: ['mixer'] },
    ])
  })

  it('routes a trigger to the matching plugin', async () => {
    const registry = new PluginRegistry()
    await registry.register(createMockMixerPlugin(), testContext())
    const result = await registry.trigger('mock-mixer', {
      type: 'set_volume',
      payload: { volume: 9 },
    })
    expect(result).toEqual({ status: 'ok', data: { volume: 9 } })
  })

  it('drops a plugin on unregister, calling its shutdown hook', async () => {
    const registry = new PluginRegistry()
    const shutdown = vi.fn()
    const plugin = { ...createMockMixerPlugin(), shutdown }
    await registry.register(plugin, testContext())
    await registry.unregister('mock-mixer')
    expect(shutdown).toHaveBeenCalledOnce()
    expect(registry.list()).toEqual([])
    expect(await registry.trigger('mock-mixer', { type: 'anything' })).toBeNull()
  })

  it('ignores unregistering a plugin that was never registered', async () => {
    const registry = new PluginRegistry()
    await expect(registry.unregister('nope')).resolves.toBeUndefined()
  })

  it('returns null for an unknown plugin', async () => {
    const registry = new PluginRegistry()
    const result = await registry.trigger('nope', { type: 'anything' })
    expect(result).toBeNull()
  })
})

describe('mockMixerPlugin', () => {
  it('defaults to volume 5, per the docs/03 hardware-mock example', () => {
    const plugin = createMockMixerPlugin()
    plugin.init(testContext())
    expect(plugin.trigger({ type: 'anything' })).toEqual({ status: 'ok', data: { volume: 5 } })
  })

  it('updates volume on set_volume and remembers it for later triggers', () => {
    const plugin = createMockMixerPlugin()
    plugin.init(testContext())
    plugin.trigger({ type: 'set_volume', payload: { volume: 7 } })
    expect(plugin.trigger({ type: 'anything' })).toEqual({ status: 'ok', data: { volume: 7 } })
  })

  it('ignores a non-numeric volume payload', () => {
    const plugin = createMockMixerPlugin()
    plugin.init(testContext())
    const result = plugin.trigger({ type: 'set_volume', payload: { volume: 'loud' } })
    expect(result).toEqual({ status: 'ok', data: { volume: 5 } })
  })
})
