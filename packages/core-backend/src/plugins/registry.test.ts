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
      payload: { channel: 'Band', volume: 9 },
    })
    expect(result).toEqual({ status: 'ok', data: { volumes: { Band: 9 } } })
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

// mockMixerPlugin's own behavior (defaults, per-channel volumes, invalid payloads) has its
// own dedicated mockMixerPlugin.test.ts - this file only covers generic PluginRegistry
// behavior (register/trigger/unregister), using the mixer plugin as a stand-in instance.
