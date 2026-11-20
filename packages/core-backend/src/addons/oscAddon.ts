import type { IShowControlPlugin, ShowControlEvent, ShowControlResult } from 'shared-types'
import { OSC_PLUGIN_ID, OSC_SEND, resolveOscTarget } from '../plugins/oscPlugin.js'
import type { NodeSandboxOptions } from './nodeSandbox.js'
import { BUILTIN_ADDONS, createAddonHost, type Log } from './addonHost.js'

/**
 * OSC as a sandboxed add-on (#964). StageBoard hands the cue to the add-on together with where this device's OSC goes (the device's own network
 * settings - StageBoard's data, not OSC's) and relays the answer. What an OSC address is, how a packet is built and what to say when it fails is the
 * add-on's.
 */
export function createOscAddonPlugin(options: { log?: Log; runHelper?: NodeSandboxOptions['runHelper'] } = {}): IShowControlPlugin {
  const sandbox = createAddonHost(BUILTIN_ADDONS.oscSend, options.log, options.runHelper)
  return {
    name: OSC_PLUGIN_ID,
    version: '0.1.0',
    capabilities: [OSC_PLUGIN_ID],
    init: () => undefined,
    async trigger(event: ShowControlEvent): Promise<ShowControlResult> {
      const target = await resolveOscTarget(event.logicalDeviceId)
      const method = event.type === OSC_SEND ? 'send' : event.type
      const outcome = await (await sandbox()).call(method, { address: event.payload?.address, args: event.payload?.args, ...(target ?? {}) }, { timeoutMs: 5_000 }).catch((err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }))
      if (!outcome.ok) return { status: 'error', message: outcome.message }
      options.log?.info('osc sent', { host: target?.host, port: target?.port })
      return { status: 'ok' }
    },
    shutdown: () => undefined,
  }
}
