import { HostMessageError, type AudioImportJob, type HostMessageCode, type TrackMeta } from 'shared-types'
import { createProgressWriter } from './progress.js'
import { errorPatch, toTrackFormat, type JobPatch } from './trackFormat.js'

/**
 * The recipe of "an add-on fetches audio" (#964, docs/36 §7), once for every platform: check the job, ask the add-on for the audio, make it a track,
 * put the file in the band's audio store, attach the track to its song variant, report progress, clean up when it fails. It knows **no service**:
 * where the audio comes from, which links are valid and what to tell the person when it fails is the add-on's - its error text goes into the job
 * as it is. Everything the recipe touches is a port of `AudioImportContext`, so a Node host and a tablet run the same job in the same order.
 */
export interface AudioImportContext {
  log: { info: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void }
  /** Writes into the job's own document. */
  patchJob(patch: JobPatch): Promise<void>
  /** The band has installed this add-on - checked here, not only in the app. */
  bandHasAddon(addonId: string): Promise<boolean>
  /** A variant id becomes a path segment under the audio store: the same check the upload route applies. */
  isSafeVariantId(id: string): boolean
  variantExists(variantId: string): Promise<boolean>
  /**
   * The add-on's part, run by the platform (a work script in a sandbox): ask `method` of `addonId` with `args`; `onProgress` gets 0-1. Throws an
   * `Error` whose message is the add-on's own words. `dispose` removes whatever the platform left behind.
   */
  fetchAudio(addonId: string, method: string, args: Record<string, unknown>, onProgress: (fraction: number) => void): Promise<{ data: Uint8Array; ext: string; dispose?: () => Promise<void> }>
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

/** Runs the job. Never throws: every outcome is written into the job's document - `done`, or `error` with its message. */
export async function runAudioImport(job: AudioImportJob, ctx: AudioImportContext): Promise<void> {
  const { log } = ctx
  log.info('Starting async job', { jobId: job.id, type: job.type, addonId: job.addonId, variantId: job.variantId })

  // A replicated document is untrusted input: the variant id becomes a path, the add-on id and method name what is asked of which sandbox.
  const rejection: { code: HostMessageCode; params?: Record<string, string> } | null = !(await ctx.bandHasAddon(job.addonId).catch(() => false))
    ? { code: 'addon.notInstalled', params: { addon: job.addonId } }
    : !ctx.isSafeVariantId(job.variantId)
      ? { code: 'job.invalidVariantId' }
      : null
  if (rejection) {
    log.error('Rejected async job', { jobId: job.id, reason: rejection.code })
    await ctx.patchJob(errorPatch(new HostMessageError(rejection.code, rejection.params))).catch((err) => log.error('Failed to mark async job as failed', { jobId: job.id, error: String(err) }))
    return
  }

  let dispose: (() => Promise<void>) | undefined
  let writtenTrackId: string | null = null
  const progress = createProgressWriter({ patch: ctx.patchJob, intervalMs: ctx.progressIntervalMs ?? 1_500, now: () => ctx.now(), onError: (err) => log.error('Failed to write job progress', { jobId: job.id, error: String(err) }) })
  try {
    await ctx.patchJob({ status: 'running', progress: 0 })
    if (!(await ctx.variantExists(job.variantId))) throw new HostMessageError('job.variantGone')
    const fetched = await ctx.fetchAudio(job.addonId, job.method, job.args, (fraction) => progress.report(fraction))
    dispose = fetched.dispose
    await progress.settled()

    const track = toTrackFormat(fetched.data, fetched.ext)
    const needsOpus = !track.remuxed
    if (needsOpus) log.info('The audio is not Opus - a device converts it', { jobId: job.id, ext: fetched.ext })
    else log.info('The audio was re-wrapped as Ogg Opus', { jobId: job.id, ext: fetched.ext })

    const trackId = ctx.newId()
    await ctx.writeAudio(job.variantId, trackId, track.data)
    writtenTrackId = trackId
    const meta: TrackMeta = { id: trackId, kind: 'reference', label: job.label, source: 'add-on', parentTrackId: null, mimeType: track.mimeType, addedAt: ctx.now(), sizeBytes: track.data.length }
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
