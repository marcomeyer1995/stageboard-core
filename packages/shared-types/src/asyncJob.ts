import { z } from 'zod'
import { ServerMessageParamsSchema } from './serverMessage.js'

/**
 * A replicated background-job document (#5): the Host watches this workspace's shared
 * db for new ones the same way it watches for plugin installs (`pluginSync.ts`) - a tablet
 * creates the doc, the server picks it up over the database `_changes` feed and does the actual
 * work (network access, a shell-out), and progress/result flow back the same way every other
 * replicated document does, no dedicated HTTP endpoint needed.
 *
 * Three job types: `youtube-extract` (#5), `stem-separation` (#9) and `opus-convert` (#822) - discriminated by `type`.
 */
export const AsyncJobStatusSchema = z.enum(['queued', 'running', 'done', 'error'])
export type AsyncJobStatus = z.infer<typeof AsyncJobStatusSchema>

const AsyncJobBase = {
  id: z.string().min(1),
  status: AsyncJobStatusSchema,
  /** 0-1. Only ever meaningful while `status === 'running'` - queued/done/error don't update it
   * further (done implies 1, the others have no notion of partial progress). */
  progress: z.number().min(0).max(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** The SongVariant this job attaches its resulting track(s) to. */
  variantId: z.string().min(1),
  /** Set once `status` reaches `error` - human-readable (German), the fallback for `errorCode`. */
  error: z.string().min(1).optional(),
  /** The error as a code the device translates (#679, serverMessage.ts), when the server has one. */
  errorCode: z.string().min(1).optional(),
  errorParams: ServerMessageParamsSchema.optional(),
  /** Who works on it (#964): `host:<hostId>` - a host that can do it took it (sync-host's job queue: a job needs a capability of
   * its host, a capable host claims it and goes on only if the job still names it once the claim has replicated); or
   * `device:<Device.id>` - a device whose own helper does the job (docs/32 §8, the YouTube helper on Android). Whoever is named keeps
   * the job, restart or not; every other host and device leaves it alone. Absent: nobody has taken it yet. */
  runner: z.string().min(1).optional(),
}

export const YoutubeExtractJobSchema = z.object({
  ...AsyncJobBase,
  type: z.literal('youtube-extract'),
  url: z.string().min(1),
  /** What to label the resulting TrackMeta - authored once at job creation, not editable
   * mid-run. */
  label: z.string().min(1),
  /** Set once `status` reaches `done` - the TrackMeta.id of the track this job produced. */
  trackId: z.string().min(1).optional(),
})

/**
 * Which stems to separate (#9): `standard` = drums, bass, vocals, rest (Demucs htdemucs);
 * `extended` = also guitar and piano/keys (htdemucs_6s). `splitGuitar` (extended only) splits the
 * guitar stem by stereo side - two main guitars panned left and right come out as two stems.
 */
export const StemModelSchema = z.enum(['standard', 'extended'])
export type StemModel = z.infer<typeof StemModelSchema>

/** Stem separation (#9, Marco 2026-10-15: on the Host): a track of the variant split into
 * stems, stored as `kind: 'stem'` tracks with `parentTrackId` = the source. A new separation of
 * the same track replaces its earlier stems. */
export const StemSeparationJobSchema = z.object({
  ...AsyncJobBase,
  type: z.literal('stem-separation'),
  sourceTrackId: z.string().min(1),
  model: StemModelSchema,
  splitGuitar: z.boolean().default(false),
  /** Set once `status` reaches `done` - the stems' TrackMeta ids. */
  stemTrackIds: z.array(z.string().min(1)).optional(),
})

/**
 * A track to be converted to Ogg Opus by a device (#822; Marco, 2026-11-14: "Gerät wandelt um"):
 * the host downloaded a video YouTube had no Opus for and has no decoder of its own. Any device
 * with the app takes it (`runner`), decodes in its browser engine and encodes with the WASM
 * encoder - one converter on every host - then replaces the track's file (`fileRev` + 1).
 */
export const OpusConvertJobSchema = z.object({
  ...AsyncJobBase,
  type: z.literal('opus-convert'),
  /** The track whose file is converted, in place. */
  trackId: z.string().min(1),
  label: z.string().min(1),
})

/**
 * Audio that an add-on fetches (docs/36 §7, #964): "get this audio and make it a track of the song". The core knows nothing of where the audio comes
 * from - YouTube, a stock library, a recorder: the add-on named by `addonId` answers `method` (`fetchAudio`) with `{audio, ext}`, and StageBoard
 * stores it, attaches it as a track and queues the Opus conversion when needed. The job is a band document like any other, so every device sees its
 * progress. A host that has the add-on's helpers takes it (`plugin:<addonId>`).
 */
export const AudioImportJobSchema = z.object({
  ...AsyncJobBase,
  type: z.literal('audio-import'),
  /** The add-on that fetches the audio. */
  addonId: z.string().min(1).max(100),
  /** The method of that add-on that answers with `{audio, ext}`. */
  method: z.string().min(1).max(100),
  /** What the method is asked (the add-on's own schema, docs/36 §3): a link, an id. */
  args: z.record(z.string(), z.unknown()),
  label: z.string().min(1),
  trackId: z.string().min(1).optional(),
})

export const AsyncJobSchema = z.discriminatedUnion('type', [YoutubeExtractJobSchema, AudioImportJobSchema, StemSeparationJobSchema, OpusConvertJobSchema])
export type AsyncJob = z.infer<typeof AsyncJobSchema>
export type YoutubeExtractJob = z.infer<typeof YoutubeExtractJobSchema>
export type AudioImportJob = z.infer<typeof AudioImportJobSchema>
export type StemSeparationJob = z.infer<typeof StemSeparationJobSchema>
export type OpusConvertJob = z.infer<typeof OpusConvertJobSchema>

/**
 * youtube.com/youtu.be only (`www.`/`m.` subdomains, `/watch`, `/shorts/`, or a bare youtu.be
 * short link) - #5 is framed as a private practice-track tool, not a general-purpose
 * downloader, and this is the one guard shared by both the client (instant feedback before a
 * job is even created) and the server (the one thing standing between an AsyncJob document and
 * a shell-out, so it's checked again there regardless of what the client already validated).
 */
const YOUTUBE_URL_RE = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/

export function isYoutubeUrl(url: string): boolean {
  return YOUTUBE_URL_RE.test(url.trim())
}
