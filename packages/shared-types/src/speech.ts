import { z } from 'zod'

/**
 * Spoken announcements (#63): the voices the Stage-Server's piper-speech plugin can use, and the
 * band's choices - stored in the plugin installations' `settings`, so every device speaks with
 * the same voice and the same texts.
 */

/** A voice's key - Piper's own naming (`de_DE-thorsten-medium`, also `pt_PT-tugão-medium`); also its
 * file name on the server, so letters, digits, `_` and `-` only - no `/` or `.`. */
export const SpeechVoiceKeySchema = z.string().regex(/^[\p{L}\p{N}_-]{1,80}$/u)
export const DEFAULT_SPEECH_VOICE = 'de_DE-thorsten-medium'

/** `piper-speech`'s settings: which voice the band uses. */
export const SPEECH_SPEED_MIN = 0.6
export const SPEECH_SPEED_MAX = 1.6
export const SpeechSpeedSchema = z.number().min(SPEECH_SPEED_MIN).max(SPEECH_SPEED_MAX)

export const SpeechSettingsSchema = z.object({
  voice: SpeechVoiceKeySchema.optional(),
  /** How fast the voice speaks: 1 = the voice's own pace, 1.3 = 30 % faster (Piper's length scale is 1/speed). */
  speed: SpeechSpeedSchema.optional(),
})
export type SpeechSettings = z.infer<typeof SpeechSettingsSchema>

export const SpeechVoiceSchema = z.object({
  key: SpeechVoiceKeySchema,
  /** Speaker name (`thorsten`, `Thorsten Hessisch`). */
  name: z.string(),
  /** `de_DE`. */
  languageCode: z.string(),
  /** `Deutsch (Deutschland)`. */
  languageName: z.string(),
  quality: z.string(),
  sizeBytes: z.number().nonnegative(),
  installed: z.boolean(),
  /** `piper`: Piper's official list; `extra`: a voice StageBoard knows from elsewhere (dialects). */
  origin: z.enum(['piper', 'extra', 'local']),
})
export type SpeechVoice = z.infer<typeof SpeechVoiceSchema>

export const SpeechVoiceDownloadSchema = z.object({
  key: SpeechVoiceKeySchema,
  receivedBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  state: z.enum(['running', 'done', 'failed']),
  error: z.string().optional(),
})
export type SpeechVoiceDownload = z.infer<typeof SpeechVoiceDownloadSchema>

export const SpeechVoicesResponseSchema = z.object({
  voices: z.array(SpeechVoiceSchema),
  /** The latest download (running, or how the last one ended). */
  download: SpeechVoiceDownloadSchema.nullable(),
  /** Where the voice list came from: fetched now, the server's saved copy, or none (offline, never fetched). */
  catalog: z.enum(['online', 'cached', 'none']),
  /** Whether the Piper program itself is installed on the server. */
  piperInstalled: z.boolean(),
})
export type SpeechVoicesResponse = z.infer<typeof SpeechVoicesResponseSchema>

export const SpeechVoiceLicenseSchema = z.object({
  key: SpeechVoiceKeySchema,
  /** As the voice's model card states it - a name (`CC0`) or a URL. Null when unknown (offline). */
  license: z.string().nullable(),
  /** Where the voice was trained from, when the card says so - its licence may apply as well. */
  finetunedFrom: z.string().nullable(),
})
export type SpeechVoiceLicense = z.infer<typeof SpeechVoiceLicenseSchema>

/**
 * `section-announcements`' settings: what is said for a part name, band-wide (#63) - "Chorus" →
 * "Refrää" for a dialect, "Verse 2" → "Zwodde Strophe". Keyed by the part name as written in the
 * songs (matched ignoring case); `null` = never announce this part. A name without an entry is
 * spoken as written.
 */
export const AnnouncementSettingsSchema = z.object({
  texts: z.record(z.string().max(80), z.string().max(80).nullable()).default({}),
  /** The part's name is said on the downbeat this many bars before the part. */
  nameBarsBefore: z.number().int().min(1).max(4).default(1),
  /** "Chorus in 3, 2, 1": the last beats before the part counted down, one word per beat. */
  countdown: z
    .object({
      enabled: z.boolean().default(false),
      /** How many beats are counted (3 = "3, 2, 1" on the last three beats of the bar before). */
      beats: z.number().int().min(1).max(8).default(3),
      /** Word per number, index 0 = "1". Empty entries: the digit, which every voice reads in its language. */
      words: z.array(z.string().max(30)).max(8).default([]),
      /** Said on the part's first beat ("Los", "Go"); null = nothing. */
      go: z.string().max(30).nullable().default(null),
    })
    .default({ enabled: false, beats: 3, words: [], go: null }),
  /**
   * The count-in before bar 1: `announce` = the part on bar 1 (Intro) is announced like any other,
   * inside the count-in bars; `count` = the count-in beats are spoken ("1, 2, 3, 4") instead;
   * `click` = nothing spoken during the count-in.
   */
  countIn: z.enum(['announce', 'count', 'click']).default('announce'),
})
export type AnnouncementSettings = z.infer<typeof AnnouncementSettingsSchema>
