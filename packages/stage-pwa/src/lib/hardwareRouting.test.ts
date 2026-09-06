import { describe, expect, it } from 'vitest'
import type { HardwareSetup, LogicalDevice } from 'shared-types'
import { resolveHardwareBinding, resolveHardwareBindingById, resolveHardwareEngine } from './hardwareRouting'

const KEMPER: LogicalDevice = { id: 'kemper-1', name: "Marco's Kemper", capability: 'midi-input' }
const KEMPER_2: LogicalDevice = { id: 'kemper-2', name: "Sarah's Kemper", capability: 'midi-input' }

function setup(bindings: HardwareSetup['bindings']): HardwareSetup {
  return { id: 'setup-1', name: 'Festival', bindings }
}

describe('resolveHardwareBindingById', () => {
  it('is null with no active setup', () => {
    expect(resolveHardwareBindingById(null, KEMPER.id)).toBeNull()
  })

  it('is null when the active setup has no binding for this exact id', () => {
    expect(resolveHardwareBindingById(setup({}), KEMPER.id)).toBeNull()
  })

  it('#102: resolves each Logical Device independently, even when two share a capability', () => {
    const binding1 = { executionTarget: 'tablet-1', pluginId: null }
    const binding2 = { executionTarget: 'tablet-2', pluginId: null }
    const active = setup({ [KEMPER.id]: binding1, [KEMPER_2.id]: binding2 })
    expect(resolveHardwareBindingById(active, KEMPER.id)).toBe(binding1)
    expect(resolveHardwareBindingById(active, KEMPER_2.id)).toBe(binding2)
  })
})

describe('resolveHardwareBinding', () => {
  it('is null with no active setup', () => {
    expect(resolveHardwareBinding([KEMPER], null, 'midi-input')).toBeNull()
  })

  it('is null when no Logical Device provides the capability', () => {
    expect(resolveHardwareBinding([KEMPER], setup({ [KEMPER.id]: { executionTarget: 'server', pluginId: null } }), 'mixer')).toBeNull()
  })

  it('is null when the active setup has no binding for the matching Logical Device', () => {
    expect(resolveHardwareBinding([KEMPER], setup({}), 'midi-input')).toBeNull()
  })

  it('resolves the binding for the first Logical Device providing the capability', () => {
    const binding = { executionTarget: 'tablet-1', pluginId: null }
    expect(resolveHardwareBinding([KEMPER], setup({ [KEMPER.id]: binding }), 'midi-input')).toBe(binding)
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
    expect(resolveHardwareEngine({ executionTarget: 'server', pluginId: null }, 'me', 'mock-playback', true)).toBe('plugin')
  })

  it('plays locally when this device is the bound target - a plugin never wins over an explicit binding', () => {
    expect(resolveHardwareEngine({ executionTarget: 'me', pluginId: null }, 'me', 'mock-playback', true)).toBe('local-mine')
    expect(resolveHardwareEngine({ executionTarget: 'me', pluginId: null }, 'me', null, true)).toBe('local-mine')
  })

  it("is not this device's job when a different device is the bound target", () => {
    expect(resolveHardwareEngine({ executionTarget: 'someone-else', pluginId: null }, 'me', 'mock-playback', true)).toBe('local-other')
    expect(resolveHardwareEngine({ executionTarget: 'someone-else', pluginId: null }, 'me', null, true)).toBe('local-other')
  })

  it('#98: a tablet binding with nothing able to execute it locally resolves to no engine at all, never a silent no-op plugin fallback', () => {
    expect(resolveHardwareEngine({ executionTarget: 'me', pluginId: null }, 'me', 'mock-playback', false)).toBe('none')
    expect(resolveHardwareEngine({ executionTarget: 'someone-else', pluginId: null }, 'me', 'mock-playback', false)).toBe('none')
  })
})
