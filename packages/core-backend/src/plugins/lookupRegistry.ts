import type { CapabilityId, ILookupPlugin, PluginContext } from 'shared-types'

/**
 * Same mechanical shape as PluginRegistry (registry.ts), for the query/response lookup
 * plugin family instead of the fire-and-forget show-control one - a separate registry
 * because the methods genuinely differ (search/fetchDetail vs. trigger), not because the
 * pattern does.
 */
export class LookupRegistry {
  private plugins = new Map<string, ILookupPlugin>()

  async register(plugin: ILookupPlugin, context: PluginContext): Promise<void> {
    await plugin.init(context)
    this.plugins.set(plugin.name, plugin)
  }

  list(): Array<{ name: string; version: string; capabilities: CapabilityId[] }> {
    return [...this.plugins.values()].map(({ name, version, capabilities }) => ({
      name,
      version,
      capabilities,
    }))
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) return
    await plugin.shutdown?.()
    this.plugins.delete(name)
  }

  async search(name: string, query: string) {
    const plugin = this.plugins.get(name)
    if (!plugin) return null
    return plugin.search(query)
  }

  async fetchDetail(name: string, resultId: string) {
    const plugin = this.plugins.get(name)
    if (!plugin) return null
    return plugin.fetchDetail(resultId)
  }
}
