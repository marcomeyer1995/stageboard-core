import {
  AnnouncementSettingsSchema,
  SpeechSettingsSchema,
  SpeechVoiceLicenseSchema,
  SpeechVoicesResponseSchema,
  type PluginInstallation,
  type SpeechVoiceLicense,
  type SpeechVoicesResponse,
} from 'shared-types'
import { getStageServerUrl } from './stageServer'

/** piper-speech's plugin id - the voice lives in its installation's settings. */
export const PIPER_SPEECH_PLUGIN = 'piper-speech'

/** The band's voice (#63), or undefined: the Stage-Server's default voice. */
export function bandSpeechVoice(installed: readonly PluginInstallation[]): string | undefined {
  const settings = SpeechSettingsSchema.safeParse(installed.find((p) => p.id === PIPER_SPEECH_PLUGIN)?.settings ?? {})
  return settings.success ? settings.data.voice : undefined
}

/** section-announcements' plugin id - the band's spoken texts live in its installation's settings. */
export const ANNOUNCEMENTS_PLUGIN = 'section-announcements'

const NO_TEXTS: Record<string, string | null> = {}

/** The band's spoken texts per part name (#63) - empty when none are set. */
export function bandAnnouncementTexts(installed: readonly PluginInstallation[]): Record<string, string | null> {
  const settings = AnnouncementSettingsSchema.safeParse(installed.find((p) => p.id === ANNOUNCEMENTS_PLUGIN)?.settings ?? {})
  return settings.success ? settings.data.texts : NO_TEXTS
}

async function call<T>(path: string, parse: (body: unknown) => T, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const base = getStageServerUrl()
  if (!base) return { ok: false, message: 'Kein Stage-Server verbunden.' }
  try {
    const response = await fetch(`${base}${path}`, init)
    const body: unknown = await response.json()
    if (!response.ok) return { ok: false, message: (body as { message?: string }).message ?? `HTTP ${response.status}` }
    return { ok: true, data: parse(body) }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

export const fetchSpeechVoices = () => call<SpeechVoicesResponse>('/speech/voices', (b) => SpeechVoicesResponseSchema.parse(b))
export const fetchVoiceLicense = (key: string) => call<SpeechVoiceLicense>(`/speech/voices/${encodeURIComponent(key)}/license`, (b) => SpeechVoiceLicenseSchema.parse(b))
export const installSpeechVoice = (key: string) => call(`/speech/voices/${encodeURIComponent(key)}/install`, () => true, { method: 'POST' })

/** What "Probehören" says, by language - the words a band hears most. */
export function previewText(languageCode: string): string {
  const family = languageCode.split('_')[0]
  if (family === 'de') return 'Refrain. Strophe zwei. Bridge. Letzter Refrain.'
  if (family === 'en') return 'Chorus. Verse two. Bridge. Last chorus.'
  if (family === 'fr') return 'Refrain. Couplet deux. Pont.'
  if (family === 'es') return 'Estribillo. Segunda estrofa. Puente.'
  if (family === 'it') return 'Ritornello. Seconda strofa. Ponte.'
  if (family === 'nl') return 'Refrein. Tweede couplet. Brug.'
  return 'Chorus. Bridge.'
}
