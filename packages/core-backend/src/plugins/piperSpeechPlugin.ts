import { CAPABILITIES, type IShowControlPlugin, type PluginContext, type ShowControlEvent, type ShowControlResult } from 'shared-types'
import { PiperSpeech, speechConfigFromEnv } from '../speech/piperSpeech.js'

/** The one speech generator of this server - shared by the plugin and the `/speech` route. */
export const serverSpeech = new PiperSpeech(speechConfigFromEnv())

export const PIPER_SPEECH_PLUGIN_ID = 'piper-speech'

/**
 * Spoken announcements' voice (#63): installing this plugin lets the Stage-Server generate speech
 * clips with Piper (`GET /speech`). Without Piper on the machine it still installs, reports it in
 * the log and on "Testen", and the devices simply stay silent (Graceful Degradation).
 */
export function createPiperSpeechPlugin(): IShowControlPlugin {
  let context: PluginContext | undefined
  return {
    name: PIPER_SPEECH_PLUGIN_ID,
    version: '0.0.1',
    capabilities: [CAPABILITIES.speechSynthesis],
    init(ctx: PluginContext) {
      context = ctx
      if (serverSpeech.available()) ctx.log.info('piper-speech ready', { voice: serverSpeech.voiceName() })
      else ctx.log.error('piper-speech: Piper or voice not installed - announcements stay silent', { voice: serverSpeech.voiceName() })
    },
    async trigger(event: ShowControlEvent): Promise<ShowControlResult> {
      if (event.type !== 'test') return { status: 'error', message: `piper-speech: unbekannter Event-Typ "${event.type}".` }
      const result = await serverSpeech.speak('Test')
      context?.log.info('piper-speech test', { ok: result.ok })
      return result.ok ? { status: 'ok', data: { voice: serverSpeech.voiceName(), bytes: result.wav.length } } : { status: 'error', message: result.message }
    },
  }
}
