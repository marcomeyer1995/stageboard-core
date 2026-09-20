import {
  CAPABILITIES,
  type IShowControlPlugin,
  type PluginContext,
  type ShowControlEvent,
  type ShowControlResult,
} from 'shared-types'

/**
 * Hardware-mock per docs/03: stands in for an automated-backup target (docs/02 backup
 * strategies). Only remembers when a backup was last requested; a real implementation swaps
 * that for an actual copy job behind the same IShowControlPlugin.trigger() contract.
 */
export function createMockBackupPlugin(): IShowControlPlugin {
  let context: PluginContext | undefined
  let lastBackupAt: number | null = null

  return {
    name: 'mock-backup',
    version: '0.0.1',
    capabilities: [CAPABILITIES.backup],
    init(ctx: PluginContext) {
      context = ctx
      context.log.info('mock-backup plugin initialized')
    },
    trigger(event: ShowControlEvent): ShowControlResult {
      context?.log.info('mock-backup received trigger', { event })
      if (event.type === 'backup') lastBackupAt = Date.now()
      return { status: 'ok', data: { lastBackupAt } }
    },
  }
}
