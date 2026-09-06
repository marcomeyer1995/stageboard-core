import { describe, expect, it } from 'vitest'
import { CAPABILITIES, type PluginInstallation } from 'shared-types'
import { hasClientTranslator, supportsLocalExecution } from './clientTranslator'

function plugin(overrides: Partial<PluginInstallation>): PluginInstallation {
  return {
    id: 'p1',
    name: 'Test Plugin',
    version: '0.0.1',
    runtime: 'both',
    capabilities: [CAPABILITIES.mixer],
    transports: [],
    enabled: true,
    installedAt: 0,
    ...overrides,
  }
}

describe('hasClientTranslator', () => {
  it('is false with nothing installed', () => {
    expect(hasClientTranslator([], CAPABILITIES.mixer)).toBe(false)
  })

  it('is false for a capability with no Translator implementation at all, even if "installed"', () => {
    expect(hasClientTranslator([plugin({ capabilities: [CAPABILITIES.backup] })], CAPABILITIES.backup)).toBe(false)
  })

  it('is false when the matching plugin is disabled', () => {
    expect(hasClientTranslator([plugin({ enabled: false })], CAPABILITIES.mixer)).toBe(false)
  })

  it('is false when the matching plugin is server-only', () => {
    expect(hasClientTranslator([plugin({ runtime: 'server' })], CAPABILITIES.mixer)).toBe(false)
  })

  it('is true for an enabled client or both-runtime plugin providing the capability', () => {
    expect(hasClientTranslator([plugin({ runtime: 'client' })], CAPABILITIES.mixer)).toBe(true)
    expect(hasClientTranslator([plugin({ runtime: 'both' })], CAPABILITIES.mixer)).toBe(true)
  })
})

describe('supportsLocalExecution', () => {
  it('is always true for audio-playback, with nothing installed at all - native browser playback', () => {
    expect(supportsLocalExecution([], CAPABILITIES.audioPlayback)).toBe(true)
  })

  it('otherwise defers to hasClientTranslator', () => {
    expect(supportsLocalExecution([], CAPABILITIES.mixer)).toBe(false)
    expect(supportsLocalExecution([plugin({ runtime: 'client' })], CAPABILITIES.mixer)).toBe(true)
  })
})
