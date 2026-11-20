import { createProgressWriter } from './progress.js'
import { isYoutubeUrl, ServerMessageError, type ServerMessageCode, type TrackMeta, type YoutubeExtractJob } from 'shared-types'
import { errorPatch, toTrackFormat, type JobPatch } from './trackFormat.js'

/**
 * The recipe of a YouTube background job, once (#964, step 3b): check the job, download the audio, make it a track, put the file in
 * the band's audio store, attach the track to its song variant, report progress, clean up when it fails. Everything the recipe touches
 * is a **port** of `YoutubeJobContext`: the band's documents and the audio store are the host's, and the one thing that is a platform's
 * own - *how the audio is downloaded* (yt-dlp on a Node machine, the add-on's helper app on Android) - is `download`. So a Node host and
 * a tablet run the same job with the same order of steps and the same errors; they differ only in the context they hand in.
 */

export interface YoutubeJobContext {
  log: { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }
  /** Writes into the job's own document. */
  patchJob(patch: JobPatch): Promise<void>
  /** The band has the YouTube-Download add-on (#546) - checked here, not only in the app. */
  bandHasAddon(): Promise<boolean>
  /** A variant id becomes a path segment under the audio store: the same check the upload route applies. */
  isSafeVariantId(id: string): boolean
  variantExists(variantId: string): Promise<boolean>
  /** The platform's own part: download the audio of `url`; `onProgress` gets 0-1. `dispose` removes whatever it left (a temp folder). */
  download(url: string, onProgress: (fraction: number) => void): Promise<{ data: Uint8Array; ext: string; dispose?: () => Promise<void> }>
  writeAudio(variantId: string, trackId: string, data: Uint8Array): Promise<void>
  deleteAudio(variantId: string, trackId: string): Promise<void>
  /** Appends to the variant's raw `tracks` array (never a parsed copy: a lost backing track is real data loss). */
  appendTrack(variantId: string, meta: TrackMeta): Promise<void>
  /** A device converts a track the host could not re-wrap to Ogg Opus (#822). */
  queueOpusConvert(variantId: string, trackId: string, label: string): Promise<void>
  newId(): string
  now(): number
  /** Progress is written at most this often (default 1.5 s): every write is a database PUT only the job's creator watches. */
  progressIntervalMs?: number
}

/** Runs the job. Never throws: every outcome is written into the job's document - `done`, or `error` with its message and code. */
export async function runYoutubeExtract(job: YoutubeExtractJob, ctx: YoutubeJobContext): Promise<void> {
  const { log } = ctx
  log.info('Starting async job', { jobId: job.id, type: job.type, variantId: job.variantId })

  // A replicated document is untrusted input: the URL guards the shell-out (shared-types' `isYoutubeUrl`), the variant id the path.
  const rejection: ServerMessageCode | null = !(await ctx.bandHasAddon().catch(() => false))
    ? 'youtube.addonMissing'
    : !isYoutubeUrl(job.url)
      ? 'youtube.urlOnly'
      : !ctx.isSafeVariantId(job.variantId)
        ? 'job.invalidVariantId'
        : null
  if (rejection) {
    log.error('Rejected async job', { jobId: job.id, reason: rejection })
    await ctx.patchJob(errorPatch(new ServerMessageError(rejection))).catch((err) => log.error('Failed to mark async job as failed', { jobId: job.id, error: String(err) }))
    return
  }

  let dispose: (() => Promise<void>) | undefined
  let writtenTrackId: string | null = null
  const progress = createProgressWriter({ patch: ctx.patchJob, intervalMs: ctx.progressIntervalMs ?? 1_500, now: () => ctx.now(), onError: (err) => log.error('Failed to write job progress', { jobId: job.id, error: String(err) }) })
  try {
    await ctx.patchJob({ status: 'running', progress: 0 })
    if (!(await ctx.variantExists(job.variantId))) throw new ServerMessageError('job.variantGone')
    const downloaded = await ctx.download(job.url, (fraction) => progress.report(fraction))
    dispose = downloaded.dispose
    await progress.settled()

    const track = toTrackFormat(downloaded.data, downloaded.ext)
    const needsOpus = !track.remuxed
    if (needsOpus) log.info('YouTube audio is not Opus - a device converts it', { jobId: job.id, ext: downloaded.ext })
    else log.info('YouTube audio re-wrapped as Ogg Opus', { jobId: job.id, ext: downloaded.ext })

    const trackId = ctx.newId()
    await ctx.writeAudio(job.variantId, trackId, track.data)
    writtenTrackId = trackId
    const meta: TrackMeta = { id: trackId, kind: 'reference', label: job.label, source: 'youtube-extract', parentTrackId: null, mimeType: track.mimeType, addedAt: ctx.now(), sizeBytes: track.data.length }
    await ctx.appendTrack(job.variantId, meta)
    if (needsOpus) await ctx.queueOpusConvert(job.variantId, trackId, job.label)
    await ctx.patchJob({ status: 'done', progress: 1, trackId })
    log.info('Async job finished', { jobId: job.id, trackId, needsOpus })
  } catch (err) {
    log.error('Async job failed', { jobId: job.id, error: err instanceof Error ? err.message : String(err) })
    // Audio written but never attached to the variant would be an orphan no UI can reach.
    if (writtenTrackId) await ctx.deleteAudio(job.variantId, writtenTrackId).catch(() => {})
    await progress.settled()
    await ctx.patchJob(errorPatch(err)).catch((patchErr) => log.error('Failed to mark async job as failed', { jobId: job.id, error: String(patchErr) }))
  } finally {
    await dispose?.().catch(() => {})
  }
}
