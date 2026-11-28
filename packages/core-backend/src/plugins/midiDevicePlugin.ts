import { DeviceTransportConfigSchema, hostMessage, type IShowControlPlugin, type PluginContext, type ShowControlEvent, type ShowControlResult } from 'shared-types'
import type { AddonInfo } from '../addons/addonMethods.js'
import { sharedAddonMethods, type AddonMethods } from '../addons/addonMethods.js'

/**
 * A MIDI device plugged into this machine (#964, step 3): Discovery gave it a role on this host and wrote its output port (`midiWatcher.ts`), and a
 * cue for it arrives here (`/plugins/<id>/trigger`, the gateway holds it until `scheduledAt`). What the cue means in MIDI is the device's **add-on**
 * (`midiDevice` in its manifest); this hands the cue over together with the device's own channel and **grants the add-on that one port for that one
 * call** - the add-on names no port and cannot send anywhere else (`capability.midi-out`). The same pattern as OSC (`addons/oscAddon.ts`).
 */
export interface MidiTarget {
  /** The output port, as this machine names it. */
  port: string
  /** 1-16. */
  channel: number
}

/** Port and channel from a device's transport config on this host; null without a port. */
export function midiTargetFromConfig(doc: unknown): MidiTarget | null {
  const parsed = DeviceTransportConfigSchema.safeParse(doc)
  if (!parsed.success) return null
  const port = parsed.data.values.midiOutputId?.trim()
  const channel = Number(parsed.data.values.midiChannel)
  return port ? { port, channel: Number.isInteger(channel) && channel >= 1 && channel <= 16 ? channel : 1 } : null
}

/** Where a device's MIDI goes on this host: the device the cue names, or else the first device of this add-on bound to this host. Set by index.ts. */
type TargetResolver = (pluginId: string, logicalDeviceId: string | undefined) => Promise<MidiTarget | null>
let resolveTarget: TargetResolver = async () => null

export function setMidiTargetResolver(resolver: TargetResolver): void {
  resolveTarget = resolver
}

export function createMidiDeviceAddonPlugin(info: AddonInfo, options: { methods?: AddonMethods } = {}): IShowControlPlugin {
  const methods = options.methods ?? sharedAddonMethods()
  let context: PluginContext | undefined
  return {
    name: info.pluginId,
    version: '1.0.0',
    capabilities: info.provides,
    init(ctx: PluginContext) {
      context = ctx
      ctx.log.info(`${info.pluginId} ready for a device plugged into this host`)
    },
    async trigger(event: ShowControlEvent): Promise<ShowControlResult> {
      const target = await resolveTarget(info.pluginId, event.logicalDeviceId).catch(() => null)
      if (!target) return { status: 'error', ...hostMessage('plugin.noMidiOut', { device: info.name }) }
      const answer = await methods.call(info.id, 'event', { type: event.type, ...(event.payload ? { payload: event.payload } : {}), midiChannel: target.channel }, { grants: [`midi-out:${target.port}`] })
      if (!answer.ok) {
        context?.log.error(`${info.pluginId}: the add-on did not answer`, { type: event.type, code: answer.error.code })
        return { status: 'error', message: answer.error.message }
      }
      return answer.body as ShowControlResult
    },
    shutdown: () => undefined,
  }
}
