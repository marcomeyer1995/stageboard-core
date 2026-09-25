import { z } from 'zod'

/**
 * A replicated background-job document (#5): the Stage-Server watches this workspace's shared
 * db for new ones the same way it watches for plugin installs (`pluginSync.ts`) - a tablet
 * creates the doc, the server picks it up over the CouchDB `_changes` feed and does the actual
 * work (network access, a shell-out), and progress/result flow back the same way every other
 * replicated document does, no dedicated HTTP endpoint needed.
 *
 * One job type today (`youtube-extract`) - the discriminated `type` field is there so a second
 * kind (e.g. the stem-separation pipeline, #9) can join this same queue later without a new
 * schema or watcher plumbing.
 */
export const AsyncJobStatusSchema = z.enum(['queued', 'running', 'done', 'error'])
export type AsyncJobStatus = z.infer<typeof AsyncJobStatusSchema>

export const AsyncJobSchema = z.object({
  id: z.string().min(1),
  type: z.literal('youtube-extract'),
  status: AsyncJobStatusSchema,
  /** 0-1. Only ever meaningful while `status === 'running'` - queued/done/error don't update it
   * further (done implies 1, the others have no notion of partial progress). */
  progress: z.number().min(0).max(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** The SongVariant this job attaches its resulting track to. */
  variantId: z.string().min(1),
  url: z.string().min(1),
  /** What to label the resulting TrackMeta - authored once at job creation, not editable
   * mid-run. */
  label: z.string().min(1),
  /** Set once `status` reaches `done` - the TrackMeta.id of the track this job produced. */
  trackId: z.string().min(1).optional(),
  /** Set once `status` reaches `error` - human-readable, shown as-is in the UI. */
  error: z.string().min(1).optional(),
})
export type AsyncJob = z.infer<typeof AsyncJobSchema>

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
