import type { CapabilityId, IShowControlPlugin, PluginContext, ShowControlEvent } from 'shared-types'

/**
 * Minimal Show Control Gateway: holds every registered hardware-facing plugin
 * and routes trigger events to them by name. The gateway never talks to
 * hardware itself - only through the IShowControlPlugin interface, so a mock
 * plugin (see mockMixerPlugin.ts) is a drop-in stand-in for a real one.
 */
export class PluginRegistry {
  private plugins = new Map<string, IShowControlPlugin>()

  async register(plugin: IShowControlPlugin, context: PluginContext): Promise<void> {
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

  /** Removes a plugin, e.g. after it was disabled in the replicated installation docs. */
  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) return
    await plugin.shutdown?.()
    this.plugins.delete(name)
  }

  get(name: string): IShowControlPlugin | undefined {
    return this.plugins.get(name)
  }

  async trigger(name: string, event: ShowControlEvent) {
    const plugin = this.plugins.get(name)
    if (!plugin) return null
    return plugin.trigger(event)
  }
}
