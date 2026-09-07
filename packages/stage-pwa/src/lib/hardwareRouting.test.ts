import { describe, expect, it } from 'vitest'
import type { LogicalDevice } from 'shared-types'
import { resolveHardwareBinding, resolveHardwareBindingById, resolveHardwareEngine } from './hardwareRouting'

function kemper(overrides: Partial<LogicalDevice> & Pick<LogicalDevice, 'id' | 'name'>): LogicalDevice {
  return { capability: 'midi-input', pluginId: null, executionTarget: null, ...overrides }
}

describe('resolveHardwareBindingById', () => {
  it('is null when no Logical Device has this exact id', () => {
    expect(resolveHardwareBindingById([], 'kemper-1')).toBeNull()
  })

  it('#102: resolves each Logical Device independently, even when two share a capability', () => {
    const kemper1 = kemper({ id: 'kemper-1', name: "Marco's Kemper", executionTarget: 'tablet-1' })
    const kemper2 = kemper({ id: 'kemper-2', name: "Sarah's Kemper", executionTarget: 'tablet-2' })
    expect(resolveHardwareBindingById([kemper1, kemper2], kemper1.id)).toBe(kemper1)
    expect(resolveHardwareBindingById([kemper1, kemper2], kemper2.id)).toBe(kemper2)
  })
})

describe('resolveHardwareBinding', () => {
  it('is null when no Logical Device provides the capability', () => {
    const kemper1 = kemper({ id: 'kemper-1', name: "Marco's Kemper" })
    expect(resolveHardwareBinding([kemper1], 'mixer')).toBeNull()
  })

  it('is null when the matching Logical Device has no binding of its own yet', () => {
    const kemper1 = kemper({ id: 'kemper-1', name: "Marco's Kemper" })
    expect(resolveHardwareBinding([kemper1], 'midi-input')).toBe(kemper1)
    expect(resolveHardwareBinding([kemper1], 'midi-input')?.executionTarget).toBeNull()
  })

  it('resolves the first Logical Device providing the capability', () => {
    const kemper1 = kemper({ id: 'kemper-1', name: "Marco's Kemper", executionTarget: 'tablet-1' })
    expect(resolveHardwareBinding([kemper1], 'midi-input')).toBe(kemper1)
  })
})

describe('resolveHardwareEngine', () => {
  it('uses the plugin when nothing is bound and a plugin is reachable', () => {
    expect(resolveHardwareEngine(null, 'me', 'mock-playback', true)).toBe('plugin')
  })

  it('falls back to no engine at all with nothing bound and no plugin', () => {
    expect(resolveHardwareEngine(null, 'me', null, true)).toBe('none')
  })

  it("uses the plugin when the binding explicitly targets the server, same as nothing bound", () => {
    const device = kemper({ id: 'k', name: 'K', executionTarget: 'server' })
    expect(resolveHardwareEngine(device, 'me', 'mock-playback', true)).toBe('plugin')
  })

  it('plays locally when this device is the bound target - a plugin never wins over an explicit binding', () => {
    const device = kemper({ id: 'k', name: 'K', executionTarget: 'me' })
    expect(resolveHardwareEngine(device, 'me', 'mock-playback', true)).toBe('local-mine')
    expect(resolveHardwareEngine(device, 'me', null, true)).toBe('local-mine')
  })

  it("is not this device's job when a different device is the bound target", () => {
    const device = kemper({ id: 'k', name: 'K', executionTarget: 'someone-else' })
    expect(resolveHardwareEngine(device, 'me', 'mock-playback', true)).toBe('local-other')
    expect(resolveHardwareEngine(device, 'me', null, true)).toBe('local-other')
  })

  it('#98: a tablet binding with nothing able to execute it locally resolves to no engine at all, never a silent no-op plugin fallback', () => {
    const mine = kemper({ id: 'k', name: 'K', executionTarget: 'me' })
    const other = kemper({ id: 'k', name: 'K', executionTarget: 'someone-else' })
    expect(resolveHardwareEngine(mine, 'me', 'mock-playback', false)).toBe('none')
    expect(resolveHardwareEngine(other, 'me', 'mock-playback', false)).toBe('none')
  })
})
