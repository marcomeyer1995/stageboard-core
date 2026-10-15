import { CAPABILITIES, type IShowControlPlugin, type PluginContext, type ShowControlEvent, type ShowControlResult } from 'shared-types'
import { stemsAvailable, stemsConfigFromEnv } from '../stems/stemSeparation.js'

export const STEM_SEPARATION_PLUGIN_ID = 'stem-separation'

/**
 * Stem separation (#9, Marco 2026-10-15: a plugin - heavy, not every band needs it): while the band
 * has it installed, the Stage-Server takes `stem-separation` jobs (asyncJobWatcher.ts) and the
 * song editor offers "Spuren trennen". The work itself is a Python/Demucs script
 * (stems/stemSeparation.ts); without it on the machine the plugin installs, says so on "Testen"
 * and jobs fail with that message.
 */
export function createStemSeparationPlugin(): IShowControlPlugin {
  let context: PluginContext | undefined
  return {
    name: STEM_SEPARATION_PLUGIN_ID,
    version: '0.0.1',
    capabilities: [CAPABILITIES.stemSeparation],
    init(ctx: PluginContext) {
      context = ctx
      if (stemsAvailable()) ctx.log.info('stem-separation ready', { python: stemsConfigFromEnv().python })
      else ctx.log.error('stem-separation: Demucs not installed - jobs will fail', { python: stemsConfigFromEnv().python })
    },
    async trigger(event: ShowControlEvent): Promise<ShowControlResult> {
      if (event.type !== 'test') return { status: 'error', message: `stem-separation: unbekannter Event-Typ "${event.type}".` }
      const ok = stemsAvailable()
      context?.log.info('stem-separation test', { ok })
      return ok ? { status: 'ok', data: { python: stemsConfigFromEnv().python } } : { status: 'error', message: 'Demucs ist auf dem Stage-Server nicht installiert (docs/03).' }
    },
  }
}
