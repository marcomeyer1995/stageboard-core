import {
  CAPABILITIES,
  type IShowControlPlugin,
  type PluginContext,
  type ShowControlEvent,
  type ShowControlResult,
} from 'shared-types'

/**
 * Hardware-mock per docs/03: stands in for a server-side click / MIDI-Clock generator (#25's
 * hardware-routed half). The tablet-local Web Audio click needs no plugin at all; this only
 * tracks on/off so routing a click-track cue to the Stage-Server resolves instead of dangling.
 */
export function createMockClickPlugin(): IShowControlPlugin {
  let context: PluginContext | undefined
  let running = false

  return {
    name: 'mock-click',
    version: '0.0.1',
    capabilities: [CAPABILITIES.clickTrack],
    init(ctx: PluginContext) {
      context = ctx
      context.log.info('mock-click plugin initialized')
    },
    trigger(event: ShowControlEvent): ShowControlResult {
      context?.log.info('mock-click received trigger', { event })
      if (event.type === 'start') running = true
      else if (event.type === 'stop') running = false
      return { status: 'ok', data: { running } }
    },
  }
}
