import { CAPABILITIES, type IShowControlPlugin, type PluginContext, type ShowControlEvent, type ShowControlResult } from 'shared-types'

/**
 * Hardware-mock per docs/03_Developer_Experience.md: stands in for a real
 * digital-mixer plugin (Soundcraft UI24R, Allen & Heath CQ18T, ...) so the
 * Show Control Gateway can be built and tested with no mixer in the room.
 * A real mixer plugin implements the exact same IShowControlPlugin interface.
 *
 * Tracks one volume per channel (docs/07 "More Me": each musician's own IEM channels plus a
 * band group fader, all independently movable - #3) rather than a single scalar, so
 * IemWidget's per-channel faders each actually get their own state instead of all fighting
 * over one shared value.
 */
export function createMockMixerPlugin(): IShowControlPlugin {
  let context: PluginContext | undefined
  const volumes: Record<string, number> = {}

  return {
    name: 'mock-mixer',
    version: '0.0.1',
    capabilities: [CAPABILITIES.mixer],
    init(ctx: PluginContext) {
      context = ctx
      context.log.info('mock-mixer plugin initialized')
    },
    trigger(event: ShowControlEvent): ShowControlResult {
      context?.log.info('mock-mixer received trigger', { event })

      if (event.type === 'set_volume') {
        const channel = event.payload?.channel
        const requested = event.payload?.volume
        if (typeof channel === 'string' && typeof requested === 'number') {
          volumes[channel] = requested
        }
      }

      return { status: 'ok', data: { volumes: { ...volumes } } }
    },
  }
}
