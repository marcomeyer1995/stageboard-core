import type { IShowControlPlugin, ShowControlEvent, ShowControlResult } from 'shared-types'
import { OSC_PLUGIN_ID, OSC_SEND, resolveOscTarget } from '../plugins/oscPlugin.js'
import { sharedAddonMethods, type AddonMethods } from './addonMethods.js'

/**
 * OSC as a sandboxed add-on (#964). StageBoard hands the cue to the add-on together with where this device's OSC goes (the device's own network
 * settings - StageBoard's data, not OSC's) and relays the answer. What an OSC address is, how a packet is built and what to say when it fails is the
 * add-on's.
 */
export function createOscAddonPlugin(options: { methods?: AddonMethods } = {}): IShowControlPlugin {
  const methods = options.methods ?? sharedAddonMethods()
  return {
    name: OSC_PLUGIN_ID,
    version: '0.1.0',
    capabilities: [OSC_PLUGIN_ID],
    init: () => undefined,
    async trigger(event: ShowControlEvent): Promise<ShowControlResult> {
      const target = await resolveOscTarget(event.logicalDeviceId)
      const method = event.type === OSC_SEND ? 'send' : event.type
      // The target is the device's own setting, so StageBoard grants exactly that one for this call: the add-on cannot send anywhere else.
      const grants = target ? [`udp:${target.host}:${target.port}`] : []
      const answer = await methods.call(OSC_PLUGIN_ID, method, { address: event.payload?.address, args: event.payload?.args, ...(target ?? {}) }, { grants })
      return answer.ok ? { status: 'ok' } : { status: 'error', message: answer.error.message }
    },
    shutdown: () => undefined,
  }
}
