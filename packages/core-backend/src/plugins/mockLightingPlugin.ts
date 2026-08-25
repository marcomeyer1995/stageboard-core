import {
  CAPABILITIES,
  type IShowControlPlugin,
  type PluginContext,
  type ShowControlEvent,
  type ShowControlResult,
} from 'shared-types'

/**
 * Second hardware-mock (docs/03), so the plugin-aware UI has more than one server-side
 * plugin to switch on and off. Stands in for a DMX bridge (QLC+, Maestro).
 */
export function createMockLightingPlugin(): IShowControlPlugin {
  let context: PluginContext | undefined
  let lastCue: string | null = null

  return {
    name: 'mock-lighting',
    version: '0.0.1',
    capabilities: [CAPABILITIES.lighting, CAPABILITIES.showControl],
    init(ctx: PluginContext) {
      context = ctx
      context.log.info('mock-lighting plugin initialized')
    },
    trigger(event: ShowControlEvent): ShowControlResult {
      context?.log.info('mock-lighting received trigger', { event })
      lastCue = event.type
      return { status: 'ok', data: { lastCue } }
    },
  }
}
