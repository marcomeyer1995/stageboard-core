import { serverMessage, type IShowControlPlugin, type PluginContext, type ShowControlEvent, type ShowControlResult } from 'shared-types'
import { addonMissingTool } from '../addons/helpers.js'
import type { AddonInfo } from '../addons/addonMethods.js'

/**
 * What the host registers for an installed add-on (#964): one plug-in per add-on, made from its **manifest** - the capabilities it provides and the helpers it
 * needs - and never from code written for that add-on. The work itself is the add-on's methods (docs/36); this is only the registry's handle, so the band's
 * installation shows up, "Testen" says whether this device has the program the add-on needs, and the device reports its health.
 */
export function createAddonPlugin(info: AddonInfo): IShowControlPlugin {
  let context: PluginContext | undefined
  return {
    name: info.pluginId,
    version: '0.0.1',
    capabilities: info.provides,
    init(ctx: PluginContext) {
      context = ctx
      const missing = addonMissingTool(info.helpers)
      if (missing) ctx.log.error(`${info.pluginId}: "${missing}" is not on this device - the add-on will report it when asked`)
      else ctx.log.info(`${info.pluginId} ready`)
    },
    async trigger(event: ShowControlEvent): Promise<ShowControlResult> {
      if (event.type !== 'test') return { status: 'error', ...serverMessage('plugin.unknownEvent', { plugin: info.pluginId, type: event.type }) }
      const missing = addonMissingTool(info.helpers)
      context?.log.info(`${info.pluginId} test`, { ok: missing === null })
      return missing === null ? { status: 'ok' } : { status: 'error', ...serverMessage('addon.toolMissing', { tool: missing, addon: info.pluginId }) }
    },
  }
}
