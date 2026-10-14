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
 * One beat of a cue pattern (#63): `''` = nothing, `{name}` = the part's name (its band text),
 * `#` = this beat's number in the bar ("2", "3" … - in the band's number words), anything else is
 * said as written ("Los").
 */
export const CueCellSchema = z.string().max(30)
export type CueCell = z.infer<typeof CueCellSchema>
export const CUE_NAME = '{name}'
export const CUE_BEAT = '#'

/**
 * What is said in the bars before a part, one cell per beat - bars earliest first, the last bar
 * ends right before the part. A cell past the end of a shorter bar is skipped, a bar with more beats
 * than cells is silent there.
 */
export const CuePatternSchema = z.array(z.array(CueCellSchema).max(16)).min(1).max(2)
export type CuePattern = z.infer<typeof CuePatternSchema>

export const DEFAULT_PART_CUE: CuePattern = [[CUE_NAME, '', '', '']]
export const DEFAULT_COUNT_IN_CUE: CuePattern = [
  ['1', '', '2', ''],
  [CUE_BEAT, CUE_BEAT, CUE_BEAT, CUE_BEAT],
]

/**
 * `section-announcements`' settings (#63), band-wide: two cue patterns - before every part, and in
 * the count-in before bar 1 (`{name}` there = the part on bar 1) - what is said for a part name
 * ("Chorus" → "Refrää" for a dialect; keyed by the name as written, matched ignoring case; `null`
 * = never announce this part, no entry = as written), and the number words for `#` (index 0 = "1",
 * empty = the digit, which every voice reads in its language).
 */
export const AnnouncementSettingsSchema = z.preprocess(
  // Before the cue patterns the number words lived in `countdown.words`.
  (raw) => {
    if (!raw || typeof raw !== 'object' || 'numberWords' in raw) return raw
    const words = (raw as { countdown?: { words?: unknown } }).countdown?.words
    return Array.isArray(words) ? { ...raw, numberWords: words } : raw
  },
  z.object({
    texts: z.record(z.string().max(80), z.string().max(80).nullable()).default({}),
    partCue: CuePatternSchema.default(DEFAULT_PART_CUE),
    countInCue: CuePatternSchema.default(DEFAULT_COUNT_IN_CUE),
    numberWords: z.array(z.string().max(30)).max(16).default([]),
  }),
)
export type AnnouncementSettings = z.infer<typeof AnnouncementSettingsSchema>
