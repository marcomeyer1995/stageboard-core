import { SpeechSpeedSchema, SpeechVoiceKeySchema, serverMessage, type ServerMessageCode, type ServerMessageParams } from 'shared-types'
import type { HostRoute, HostRouteResponse } from './routes.js'

/**
 * The spoken announcements' routes (#63) as routes of the shared table (#964): what a device sends (`GET /speech?text=&voice=&speed=`, the voice
 * catalogue, a licence, an install) is validated and answered **once**, here - the 400s with their message codes, the 404 while the band has not
 * installed the plugin, the 503/500 when the engine cannot or fails, the cache header on a clip that never changes. The engine itself (Piper and
 * its voice files on a Node machine) is the platform's: the ports below. A host without an engine passes no ports and these routes are not in its
 * table - a request for them is then the capability refusal (501), not a 404.
 */
export type SpeechResult =
  | { ok: true; wav: Uint8Array; generated: boolean }
  | { ok: false; reason: 'unavailable' | 'failed'; message: string; messageCode?: ServerMessageCode; messageParams?: ServerMessageParams }

export interface SpeechPorts {
  /** The band has the speech plugin installed on this host. */
  pluginInstalled(): boolean
  /** The text as the engine will speak it (whitespace, length); empty: nothing to say. */
  normalise(text: string): string
  speak(text: string, voice?: string, speed?: number): Promise<SpeechResult>
  voices: {
    list(): Promise<unknown>
    license(key: string): Promise<unknown>
    /** false: a download is already running. */
    install(key: string): Promise<boolean>
  }
  log?: { info: (meta: Record<string, unknown>, message: string) => void; error: (meta: Record<string, unknown>, message: string) => void }
}

const error = (status: number, code: ServerMessageCode): HostRouteResponse => ({ status, body: { status: 'error', ...serverMessage(code) } })
const missingPlugin = (): HostRouteResponse => error(404, 'speech.pluginMissing')
/** A clip never changes for the same text and voice, so a device may keep it for good. */
const CLIP_CACHE = 'public, max-age=31536000, immutable'

export function createSpeechRoutes(ports: SpeechPorts): HostRoute[] {
  const keyOf = (raw: string | undefined) => SpeechVoiceKeySchema.safeParse(raw ?? '')
  return [
    {
      method: 'GET',
      pattern: '/speech',
      handle: async (request) => {
        const query = request.query as { text?: unknown; voice?: unknown; speed?: unknown }
        const text = ports.normalise(String(query.text ?? ''))
        if (!text) return error(400, 'speech.textMissing')
        const voice = query.voice === undefined || query.voice === '' ? undefined : SpeechVoiceKeySchema.safeParse(query.voice)
        if (voice && !voice.success) return error(400, 'speech.invalidVoice')
        const speed = query.speed === undefined || query.speed === '' ? undefined : SpeechSpeedSchema.safeParse(Number(query.speed))
        if (speed && !speed.success) return error(400, 'speech.invalidSpeed')
        if (!ports.pluginInstalled()) return missingPlugin()
        const result = await ports.speak(text, voice?.data, speed?.data)
        if (!result.ok) {
          ports.log?.error({ text, voice: voice?.data, reason: result.reason, message: result.message }, 'Speech clip failed')
          return { status: result.reason === 'unavailable' ? 503 : 500, body: { status: 'error', message: result.message, messageCode: result.messageCode, messageParams: result.messageParams } }
        }
        if (result.generated) ports.log?.info({ text, voice: voice?.data, bytes: result.wav.length }, 'Speech clip generated')
        return { status: 200, binary: { data: result.wav, contentType: 'audio/wav' }, headers: { 'Cache-Control': CLIP_CACHE } }
      },
    },
    {
      method: 'GET',
      pattern: '/speech/voices',
      handle: async () => (ports.pluginInstalled() ? { status: 200, body: await ports.voices.list() } : missingPlugin()),
    },
    {
      method: 'GET',
      pattern: '/speech/voices/:key/license',
      handle: async (request) => {
        const key = keyOf(request.params.key)
        if (!key.success) return error(400, 'speech.invalidVoice')
        return ports.pluginInstalled() ? { status: 200, body: await ports.voices.license(key.data) } : missingPlugin()
      },
    },
    {
      method: 'POST',
      pattern: '/speech/voices/:key/install',
      handle: async (request) => {
        const key = keyOf(request.params.key)
        if (!key.success) return error(400, 'speech.invalidVoice')
        if (!ports.pluginInstalled()) return missingPlugin()
        if (!(await ports.voices.install(key.data))) return error(409, 'speech.downloadBusy')
        ports.log?.info({ voice: key.data }, 'Speech voice download started')
        return { status: 200, body: { status: 'ok' } }
      },
    },
  ]
}
