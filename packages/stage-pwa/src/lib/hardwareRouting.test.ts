import { describe, expect, it } from 'vitest'
import type { HardwareSetup, LogicalDevice } from 'shared-types'
import { resolveHardwareBinding, resolveHardwareEngine } from './hardwareRouting'

const KEMPER: LogicalDevice = { id: 'kemper-1', name: "Marco's Kemper", capability: 'midi-input' }

function setup(bindings: HardwareSetup['bindings']): HardwareSetup {
  return { id: 'setup-1', name: 'Festival', bindings }
}

describe('resolveHardwareBinding', () => {
  it('is null with no active setup', () => {
    expect(resolveHardwareBinding([KEMPER], null, 'midi-input')).toBeNull()
  })

  it('is null when no Logical Device provides the capability', () => {
    expect(resolveHardwareBinding([KEMPER], setup({ [KEMPER.id]: { executionTarget: 'server' } }), 'mixer')).toBeNull()
  })

  it('is null when the active setup has no binding for the matching Logical Device', () => {
    expect(resolveHardwareBinding([KEMPER], setup({}), 'midi-input')).toBeNull()
  })

  it('resolves the binding for the first Logical Device providing the capability', () => {
    const binding = { executionTarget: 'tablet-1' }
    expect(resolveHardwareBinding([KEMPER], setup({ [KEMPER.id]: binding }), 'midi-input')).toBe(binding)
  })
})

describe('resolveHardwareEngine', () => {
  it('uses the plugin when nothing is bound and a plugin is reachable', () => {
    expect(resolveHardwareEngine(null, 'me', 'mock-playback')).toBe('plugin')
  })

  it('falls back to no engine at all with nothing bound and no plugin', () => {
    expect(resolveHardwareEngine(null, 'me', null)).toBe('none')
  })

  it("uses the plugin when the binding explicitly targets the server, same as nothing bound", () => {
    expect(resolveHardwareEngine({ executionTarget: 'server' }, 'me', 'mock-playback')).toBe('plugin')
  })

  it('plays locally when this device is the bound target - a plugin never wins over an explicit binding', () => {
    expect(resolveHardwareEngine({ executionTarget: 'me' }, 'me', 'mock-playback')).toBe('local-mine')
    expect(resolveHardwareEngine({ executionTarget: 'me' }, 'me', null)).toBe('local-mine')
  })

  it("is not this device's job when a different device is the bound target", () => {
    expect(resolveHardwareEngine({ executionTarget: 'someone-else' }, 'me', 'mock-playback')).toBe('local-other')
    expect(resolveHardwareEngine({ executionTarget: 'someone-else' }, 'me', null)).toBe('local-other')
  })
})
