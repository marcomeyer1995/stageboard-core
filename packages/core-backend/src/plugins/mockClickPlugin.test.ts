import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from 'shared-types'
import { createMockClickPlugin } from './mockClickPlugin.js'

function testContext(): PluginContext {
  return { log: { info: vi.fn(), error: vi.fn() } }
}

describe('mockClickPlugin', () => {
  it('starts stopped, toggles on start/stop and ignores other events', () => {
    const plugin = createMockClickPlugin()
    plugin.init(testContext())
    expect(plugin.trigger({ type: 'status' })).toEqual({ status: 'ok', data: { running: false } })
    expect(plugin.trigger({ type: 'start' })).toEqual({ status: 'ok', data: { running: true } })
    expect(plugin.trigger({ type: 'status' })).toEqual({ status: 'ok', data: { running: true } })
    expect(plugin.trigger({ type: 'stop' })).toEqual({ status: 'ok', data: { running: false } })
  })
})
