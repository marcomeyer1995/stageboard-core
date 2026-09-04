import { describe, expect, it } from 'vitest'
import { resolveDeviceClaimEngine } from './deviceClaimEngine'

describe('resolveDeviceClaimEngine', () => {
  it('uses the plugin when no device is claimed and a plugin is reachable', () => {
    expect(resolveDeviceClaimEngine(undefined, 'me', 'mock-playback')).toBe('plugin')
  })

  it('falls back to no engine at all with no claim and no plugin', () => {
    expect(resolveDeviceClaimEngine(undefined, 'me', null)).toBe('none')
  })

  it('plays locally when this device is the claimed one - a plugin never wins over an explicit claim', () => {
    expect(resolveDeviceClaimEngine('me', 'me', 'mock-playback')).toBe('local-mine')
    expect(resolveDeviceClaimEngine('me', 'me', null)).toBe('local-mine')
  })

  it("is not this device's job when a different device is the claimed one", () => {
    expect(resolveDeviceClaimEngine('someone-else', 'me', 'mock-playback')).toBe('local-other')
    expect(resolveDeviceClaimEngine('someone-else', 'me', null)).toBe('local-other')
  })
})
