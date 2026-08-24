import type { IShowControlPlugin, PluginContext, ShowControlEvent, ShowControlResult } from 'shared-types'

/**
 * Hardware-mock per docs/03_Developer_Experience.md: stands in for a real
 * digital-mixer plugin (Soundcraft UI24R, Allen & Heath CQ18T, ...) so the
 * Show Control Gateway can be built and tested with no mixer in the room.
 * A real mixer plugin implements the exact same IShowControlPlugin interface.
 */
export function createMockMixerPlugin(): IShowControlPlugin {
  let context: PluginContext | undefined
  let volume = 5

  return {
    name: 'mock-mixer',
    version: '0.0.1',
    init(ctx: PluginContext) {
      context = ctx
      context.log.info('mock-mixer plugin initialized')
    },
    trigger(event: ShowControlEvent): ShowControlResult {
      context?.log.info('mock-mixer received trigger', { event })

      if (event.type === 'set_volume') {
        const requested = event.payload?.volume
        volume = typeof requested === 'number' ? requested : volume
        return { status: 'ok', data: { volume } }
      }

      return { status: 'ok', data: { volume } }
    },
  }
}
