import { serverMessage, type IShowControlPlugin, type ShowControlEvent, type ShowControlResult } from 'shared-types'
import { OSC_PLUGIN_ID, OSC_SEND, resolveOscTarget } from '../plugins/oscPlugin.js'
import type { NodeSandboxOptions } from './nodeSandbox.js'
import { BUILTIN_ADDONS, createAddonHost, type Log } from './addonHost.js'

/**
 * OSC as a sandboxed add-on (#964). The add-on turns the cue into an OSC packet and asks the device's `udp-send` helper to send it; this adapter keeps
 * what is StageBoard's: where the device's OSC goes (its own network settings) and the musician's words for a failure - the same messages as the
 * built-in plugin.
 */
export function createOscAddonPlugin(options: { log?: Log; runHelper?: NodeSandboxOptions['runHelper'] } = {}): IShowControlPlugin {
  const sandbox = createAddonHost(BUILTIN_ADDONS.oscSend, options.log, options.runHelper)
  return {
    name: OSC_PLUGIN_ID,
    version: '0.1.0',
    capabilities: [OSC_PLUGIN_ID],
    init: () => undefined,
    async trigger(event: ShowControlEvent): Promise<ShowControlResult> {
      if (event.type !== OSC_SEND) return { status: 'error', ...serverMessage('osc.unknownCommand', { type: event.type }) }
      const address = typeof event.payload?.address === 'string' ? event.payload.address : ''
      const target = await resolveOscTarget(event.logicalDeviceId)
      if (!target) return { status: 'error', ...serverMessage('osc.noTarget') }
      try {
        const outcome = await (await sandbox()).call('send', { address, args: typeof event.payload?.args === 'string' ? event.payload.args : '', host: target.host, port: target.port }, { timeoutMs: 5_000 })
        if (!outcome.ok) return { status: 'error', ...serverMessage('osc.sendFailed', { host: target.host, port: target.port, error: outcome.message }) }
        if ((outcome.data as { error?: string } | undefined)?.error === 'invalid-address') return { status: 'error', ...serverMessage('osc.invalidAddress', { address: address.trim() }) }
        options.log?.info('osc sent', { address, host: target.host, port: target.port })
        return { status: 'ok' }
      } catch (err) {
        return { status: 'error', ...serverMessage('osc.sendFailed', { host: target.host, port: target.port, error: err instanceof Error ? err.message : String(err) }) }
      }
    },
    shutdown: () => undefined,
  }
}
