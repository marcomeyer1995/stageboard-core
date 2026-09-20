import { describe, expect, it, vi } from 'vitest'
import type { PluginContext } from 'shared-types'
import { createMockBackupPlugin } from './mockBackupPlugin.js'

function testContext(): PluginContext {
  return { log: { info: vi.fn(), error: vi.fn() } }
}

describe('mockBackupPlugin', () => {
  it('starts with no backup recorded', () => {
    const plugin = createMockBackupPlugin()
    plugin.init(testContext())
    expect(plugin.trigger({ type: 'status' })).toEqual({ status: 'ok', data: { lastBackupAt: null } })
  })

  it('records when a backup was requested', () => {
    const plugin = createMockBackupPlugin()
    plugin.init(testContext())
    const result = plugin.trigger({ type: 'backup' })
    expect(result.status).toBe('ok')
    expect(typeof (result.data as { lastBackupAt: unknown }).lastBackupAt).toBe('number')
  })
})
