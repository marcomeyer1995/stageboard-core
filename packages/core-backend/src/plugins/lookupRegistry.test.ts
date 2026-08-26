import { describe, expect, it, vi } from 'vitest'
import type { ILookupPlugin, PluginContext } from 'shared-types'
import { LookupRegistry } from './lookupRegistry.js'

function testContext(): PluginContext {
  return { log: { info: vi.fn(), error: vi.fn() } }
}

function fakePlugin(overrides: Partial<ILookupPlugin> = {}): ILookupPlugin {
  return {
    name: 'fake-lookup',
    version: '0.0.1',
    capabilities: [],
    init: vi.fn(),
    search: vi.fn(async (query: string) => [{ id: '1', title: `Result for ${query}` }]),
    fetchDetail: vi.fn(async (resultId: string) => ({ chordProContent: `content for ${resultId}` })),
    ...overrides,
  }
}

describe('LookupRegistry', () => {
  it('lists a registered plugin', async () => {
    const registry = new LookupRegistry()
    await registry.register(fakePlugin(), testContext())
    expect(registry.list()).toEqual([{ name: 'fake-lookup', version: '0.0.1', capabilities: [] }])
  })

  it('routes a search to the matching plugin', async () => {
    const registry = new LookupRegistry()
    await registry.register(fakePlugin(), testContext())
    expect(await registry.search('fake-lookup', 'wonderwall')).toEqual([
      { id: '1', title: 'Result for wonderwall' },
    ])
  })

  it('routes fetchDetail to the matching plugin', async () => {
    const registry = new LookupRegistry()
    await registry.register(fakePlugin(), testContext())
    expect(await registry.fetchDetail('fake-lookup', 'result-1')).toEqual({
      chordProContent: 'content for result-1',
    })
  })

  it('drops a plugin on unregister, calling its shutdown hook', async () => {
    const registry = new LookupRegistry()
    const shutdown = vi.fn()
    await registry.register(fakePlugin({ shutdown }), testContext())
    await registry.unregister('fake-lookup')
    expect(shutdown).toHaveBeenCalledOnce()
    expect(registry.list()).toEqual([])
  })

  it('ignores unregistering a plugin that was never registered', async () => {
    const registry = new LookupRegistry()
    await expect(registry.unregister('nope')).resolves.toBeUndefined()
  })

  it('returns null for an unknown provider on search and fetchDetail', async () => {
    const registry = new LookupRegistry()
    expect(await registry.search('nope', 'query')).toBeNull()
    expect(await registry.fetchDetail('nope', 'id')).toBeNull()
  })
})
