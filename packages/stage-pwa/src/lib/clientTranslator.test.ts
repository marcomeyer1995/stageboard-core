import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAPABILITIES, type PluginInstallation } from 'shared-types'

const loadClientPlugin = vi.hoisted(() => vi.fn())
vi.mock('./loadClientPlugin', () => ({ loadClientPlugin }))

const { getTranslator, hasClientTranslator, preloadDynamicTranslator, supportsLocalExecution } = await import(
  './clientTranslator'
)

const DYNAMIC_CAPABILITY = 'kemper-fx'

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

describe('preloadDynamicTranslator (#109)', () => {
  beforeEach(() => {
    loadClientPlugin.mockReset()
  })

  it('is a no-op, never touching loadClientPlugin, when no installed plugin has a clientSource for the capability', async () => {
    await preloadDynamicTranslator(DYNAMIC_CAPABILITY, [plugin({ capabilities: [DYNAMIC_CAPABILITY] })], null)
    expect(loadClientPlugin).not.toHaveBeenCalled()
    expect(hasClientTranslator([plugin({ capabilities: [DYNAMIC_CAPABILITY] })], DYNAMIC_CAPABILITY)).toBe(false)
  })

  it('loads, registers, and makes the capability pass hasClientTranslator/getTranslator', async () => {
    const kemper = plugin({
      id: 'kemper',
      capabilities: [DYNAMIC_CAPABILITY],
      clientSource: 'https://cdn.example/kemper.js',
    })
    const translator = vi.fn()
    loadClientPlugin.mockResolvedValue({ id: 'kemper', registerTranslator: () => translator })

    await preloadDynamicTranslator(DYNAMIC_CAPABILITY, [kemper], 'https://stage.local')

    expect(loadClientPlugin).toHaveBeenCalledWith(kemper, 'https://stage.local')
    expect(hasClientTranslator([kemper], DYNAMIC_CAPABILITY)).toBe(true)
    expect(getTranslator(DYNAMIC_CAPABILITY)).toBe(translator)
  })

  it('#109: disabling the plugin afterward makes hasClientTranslator false again, even though the loaded code stays cached', async () => {
    const kemper = plugin({
      id: 'kemper-2',
      capabilities: [DYNAMIC_CAPABILITY + '-2'],
      clientSource: 'https://cdn.example/kemper2.js',
    })
    loadClientPlugin.mockResolvedValue({ id: 'kemper-2', registerTranslator: () => vi.fn() })
    await preloadDynamicTranslator(DYNAMIC_CAPABILITY + '-2', [kemper], null)
    expect(hasClientTranslator([kemper], DYNAMIC_CAPABILITY + '-2')).toBe(true)

    const disabled = { ...kemper, enabled: false }
    expect(hasClientTranslator([disabled], DYNAMIC_CAPABILITY + '-2')).toBe(false)
  })

  it('deduplicates concurrent preload calls for the same capability into one loadClientPlugin call', async () => {
    const kemper = plugin({
      id: 'kemper-3',
      capabilities: [DYNAMIC_CAPABILITY + '-3'],
      clientSource: 'https://cdn.example/kemper3.js',
    })
    let resolveLoad!: (value: unknown) => void
    loadClientPlugin.mockReturnValue(new Promise((resolve) => (resolveLoad = resolve)))

    const first = preloadDynamicTranslator(DYNAMIC_CAPABILITY + '-3', [kemper], null)
    const second = preloadDynamicTranslator(DYNAMIC_CAPABILITY + '-3', [kemper], null)
    resolveLoad({ id: 'kemper-3', registerTranslator: () => vi.fn() })
    await Promise.all([first, second])

    expect(loadClientPlugin).toHaveBeenCalledTimes(1)
  })

  it('leaves hasClientTranslator false when the load fails, without throwing', async () => {
    const kemper = plugin({
      id: 'kemper-4',
      capabilities: [DYNAMIC_CAPABILITY + '-4'],
      clientSource: 'https://cdn.example/kemper4.js',
    })
    loadClientPlugin.mockRejectedValue(new Error('network error'))

    await expect(preloadDynamicTranslator(DYNAMIC_CAPABILITY + '-4', [kemper], null)).resolves.toBeUndefined()
    expect(hasClientTranslator([kemper], DYNAMIC_CAPABILITY + '-4')).toBe(false)
  })
})
